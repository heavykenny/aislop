import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runSubprocess } from "../src/utils/subprocess.js";

// A zombie still occupies a slot in the process table, so kill(pid, 0)
// succeeds on it even though it is not really running - it is just waiting
// for its parent to call wait() and reap it. That reap never happens when
// the parent has already died and the zombie reparents to a PID 1 that is
// not an init/reaper (e.g. a bare `node`/`sh` entrypoint in a minimal CI
// container, as opposed to a desktop OS or an init process like tini). On
// Linux, cross-check /proc/<pid>/stat: the state field right after the
// comm's closing paren (comm itself can contain spaces or parens, so split
// on the LAST ")") is "Z" for a zombie, which this treats as dead.
const isProcessAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
	} catch {
		return false;
	}
	if (process.platform !== "linux") return true;
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
		const afterComm = stat.slice(stat.lastIndexOf(")") + 1).trim();
		const state = afterComm.split(" ")[0];
		return state !== "Z";
	} catch {
		// The process vanished between the kill(pid, 0) check and this read.
		return false;
	}
};

describe("runSubprocess timeout", () => {
	it("kills the whole process tree on timeout, not just the direct child", async () => {
		const pidFile = path.join(tmpdir(), `aislop-treekill-${process.pid}-${Date.now()}.pid`);
		// The direct child spawns a grandchild (like cppcheck -j spawning
		// workers), records its PID, then idles until the timeout reaps it.
		// On Windows the grandchild is detached: a node middleman puts its
		// children in a kill-on-close Job Object, which real scanner binaries
		// do not do - detaching opts out so the test models a real tool tree.
		const parentScript = [
			`const child = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: process.platform === "win32" });`,
			`require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
			"setInterval(() => {}, 1000);",
		].join("\n");

		let grandchildPid: number | undefined;
		try {
			await expect(
				runSubprocess(process.execPath, ["-e", parentScript], { timeout: 2000 }),
			).rejects.toThrow(/timed out/);

			grandchildPid = Number(readFileSync(pidFile, "utf-8"));
			expect(Number.isInteger(grandchildPid)).toBe(true);

			// The tree kill is asynchronous (taskkill on Windows, signal
			// escalation elsewhere) - poll rather than asserting instantly.
			const deadline = Date.now() + 5000;
			while (isProcessAlive(grandchildPid) && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			expect(isProcessAlive(grandchildPid)).toBe(false);
		} finally {
			if (grandchildPid !== undefined && isProcessAlive(grandchildPid)) {
				try {
					process.kill(grandchildPid, "SIGKILL");
				} catch {}
			}
			rmSync(pidFile, { force: true });
		}
	});
});

describe("runSubprocess timeout under event-loop starvation", () => {
	it("does not reject a child that completed while the event loop was blocked", async () => {
		// The child exits almost immediately, well inside the 500ms timeout.
		// The test then blocks the event loop past the timeout expiry, so on
		// wake the expired timer callback runs before the child's exit/close
		// events (timers phase precedes poll phase). The completion must win.
		const promise = runSubprocess(process.execPath, ["-e", "process.stdout.write('ok')"], {
			timeout: 500,
		});

		// Hop into a check-phase (setImmediate) callback first: its loop
		// iteration is already past the poll phase, so after the spin the
		// NEXT iteration begins with the timers phase and runs the (now
		// expired) timeout timer BEFORE the poll phase that would deliver the
		// child's exit/close events. Spinning from a poll- or timers-phase
		// continuation instead would let the completion win by accident and
		// mask the bug.
		await new Promise((resolve) => setImmediate(resolve));

		// Starve the loop: the child (an independent OS process) runs and
		// exits during the spin, but its exit/close events cannot be
		// processed until the spin ends - after the timer has already expired.
		const spinUntil = Date.now() + 1200;
		while (Date.now() < spinUntil) {
			// Busy-wait: simulates a synchronous engine pass starving the loop.
		}

		await expect(promise).resolves.toMatchObject({ stdout: "ok", exitCode: 0 });
	});
});

describe("runSubprocess output capture", () => {
	it("does not block a child writing faster than the parent can drain a starved pipe", async () => {
		// On Windows, child-side pipe writes are synchronous: once the 64KiB OS
		// pipe buffer fills, write() blocks until the parent drains it. A
		// starved parent event loop never drains, so the child stalls at zero
		// CPU. Capturing output through temp files instead of pipes removes
		// the parent from that path entirely - the child should finish writing
		// well before the parent's busy spin ends.
		const markerFile = path.join(
			tmpdir(),
			`aislop-backpressure-${process.pid}-${Date.now()}.marker`,
		);
		const childScript = [
			`const fs = require("node:fs");`,
			// Built at runtime, not inlined as a literal: embedding a 64KiB
			// string directly in the -e argument overflows the Windows
			// command-line length limit before the process even spawns.
			`const chunk = "x".repeat(65536);`, // 64KiB, matches the OS pipe buffer size
			// 16 x 64KiB = 1MiB, far past the pipe buffer a starved parent leaves full.
			`for (let i = 0; i < 16; i++) { process.stdout.write(chunk); }`,
			`fs.writeFileSync(${JSON.stringify(markerFile)}, String(Date.now()));`,
		].join("\n");

		try {
			const promise = runSubprocess(process.execPath, ["-e", childScript], { timeout: 10000 });

			// Hop into a check-phase callback before starving the loop, matching
			// the other starvation test's phase-ordering discipline.
			await new Promise((resolve) => setImmediate(resolve));

			// Starve the loop: the child runs and writes its full output during
			// the spin, independent of whether the parent is draining anything.
			const spinUntil = Date.now() + 2000;
			while (Date.now() < spinUntil) {
				// Busy-wait: simulates a synchronous engine pass starving the loop.
			}
			const spinEnd = Date.now();

			const result = await promise;

			expect(result.stdout.length).toBe(1048576);

			const markerTimestamp = Number(readFileSync(markerFile, "utf-8"));
			expect(markerTimestamp).toBeLessThan(spinEnd - 1500);
		} finally {
			rmSync(markerFile, { force: true });
		}
	});
});
