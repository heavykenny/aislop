import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

interface SubprocessResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

// A timed-out tool (e.g. cppcheck -j) can have spawned worker processes of its
// own; killing only the direct child leaves those workers running as orphans.
// This kills the whole tree instead. Windows has no process groups, so it
// shells out to taskkill's /T (tree) flag; POSIX relies on the child having
// been spawned detached (see below) so its pid doubles as a process-group id.
const killProcessTree = (child: ChildProcess): void => {
	if (process.platform === "win32") {
		if (child.pid === undefined) {
			child.kill("SIGTERM");
			return;
		}
		// taskkill walks the tree by parent pid, so the parent must still be
		// alive when it runs - calling child.kill() first would sever the
		// walk and orphan the very workers this is meant to reap.
		const taskkill = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
		});
		// A missing taskkill binary must not crash the process; the timeout
		// rejection still fires regardless of whether this succeeds.
		taskkill.once("error", () => {});
		return;
	}

	if (child.pid === undefined) {
		child.kill("SIGTERM");
		setTimeout(() => child.kill("SIGKILL"), 1000).unref();
		return;
	}
	const pid = child.pid;
	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		child.kill("SIGTERM");
	}
	setTimeout(() => {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			child.kill("SIGKILL");
		}
	}, 1000).unref();
};

interface OutputCapture {
	tempDir: string;
	stdoutPath: string;
	stderrPath: string;
	outFd: number;
	errFd: number;
}

// Output goes through temp files instead of pipes: the OS pipe buffer is
// 64KB, and on Windows a child-side pipe write() is synchronous, blocking
// once that buffer fills until the parent drains it. A parent stuck in a
// long synchronous pass (e.g. aislop's per-file engine work) never drains,
// so the child would stall at zero CPU; a file write needs no parent at all.
const createOutputCapture = (): OutputCapture => {
	const tempDir = mkdtempSync(path.join(tmpdir(), "aislop-"));
	const stdoutPath = path.join(tempDir, "stdout.log");
	const stderrPath = path.join(tempDir, "stderr.log");
	let outFd: number | undefined;
	try {
		outFd = openSync(stdoutPath, "w");
		const errFd = openSync(stderrPath, "w");
		return { tempDir, stdoutPath, stderrPath, outFd, errFd };
	} catch (error) {
		if (outFd !== undefined) {
			try {
				closeSync(outFd);
			} catch {
				// stdout fd may already be unusable if the failure came from
				// opening stderr; nothing more to release for it either way.
			}
		}
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Best-effort: leaking an occasional temp dir is acceptable.
		}
		throw error;
	}
};

export const runSubprocess = (
	command: string,
	args: string[],
	options: {
		cwd?: string;
		timeout?: number;
		env?: Record<string, string>;
	} = {},
): Promise<SubprocessResult> => {
	return new Promise((resolve, reject) => {
		let capture: OutputCapture;
		try {
			capture = createOutputCapture();
		} catch (error) {
			reject(
				new Error(`Failed to prepare output capture for ${command}: ${(error as Error).message}`),
			);
			return;
		}

		const child = spawn(command, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			stdio: ["ignore", capture.outFd, capture.errFd],
			windowsHide: true,
			// Makes the child a process-group leader on POSIX so a timeout can
			// signal the whole group via a negative pid, not just this process.
			// win32 ignores `detached` for grouping purposes; taskkill handles
			// the tree there instead (see killProcessTree).
			detached: process.platform !== "win32",
		});

		// Runs exactly once, on whichever of 'close'/'error' fires first (a
		// spawn failure can still emit 'close' afterward). Not gated behind
		// `settled`: a timeout already rejected before the killed child's
		// 'close' arrives, but the temp files must still be read and removed.
		let cleanedUp = false;
		const cleanup = (): { stdout: string; stderr: string } => {
			if (cleanedUp) return { stdout: "", stderr: "" };
			cleanedUp = true;
			closeSync(capture.outFd);
			closeSync(capture.errFd);
			const stdout = readFileSync(capture.stdoutPath, "utf-8").trim();
			const stderr = readFileSync(capture.stderrPath, "utf-8").trim();
			// Best-effort: on Windows a just-killed child can still hold the
			// file handle briefly, so removal can fail here - leaking an
			// occasional temp file/dir into the OS tmpdir is acceptable.
			try {
				rmSync(capture.tempDir, { recursive: true, force: true });
			} catch {
				// Best-effort: leaking an occasional temp dir is acceptable.
			}
			return { stdout, stderr };
		};

		let settled = false;
		let timer: NodeJS.Timeout | undefined;

		const finalize = (callback: () => void) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			callback();
		};

		if (options.timeout && options.timeout > 0) {
			timer = setTimeout(() => {
				// Under a starved event loop an expired timer can fire on the
				// same wake-up that carries the child's own exit/close events,
				// and the timers phase runs first. Deferring one phase via
				// setImmediate lets a completion that already happened win
				// instead of being misreported as a timeout; a still-running
				// child just gets killed one phase later.
				setImmediate(() => {
					if (settled) return;
					// The child may have exited during the same starved stretch
					// that delayed this timer, with its 'close' event still one
					// poll iteration away (the pipe EOF takes an extra read
					// round-trip). If the OS-level exit has been observed, let
					// that completion resolve normally instead of misreporting
					// a finished command as a timeout.
					if (child.exitCode !== null || child.signalCode !== null) return;
					killProcessTree(child);
					finalize(() =>
						reject(new Error(`Command timed out after ${options.timeout}ms: ${command}`)),
					);
				});
			}, options.timeout);
			timer.unref();
		}

		child.once("error", (error: NodeJS.ErrnoException) => {
			cleanup();
			finalize(() => {
				const wrapped: NodeJS.ErrnoException = new Error(
					`Failed to run ${command}: ${error.message}`,
				);
				if (error.code) wrapped.code = error.code;
				reject(wrapped);
			});
		});
		child.once("close", (code) => {
			const { stdout, stderr } = cleanup();
			finalize(() => resolve({ stdout, stderr, exitCode: code }));
		});
	});
};

export const isToolInstalled = async (tool: string): Promise<boolean> => {
	try {
		const result = await runSubprocess("which", [tool]);
		return result.exitCode === 0 && result.stdout.length > 0;
	} catch {
		return false;
	}
};
