import { spawn } from "node:child_process";

interface SubprocessResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

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
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});

		const stdoutBuffers: Buffer[] = [];
		const stderrBuffers: Buffer[] = [];

		child.stdout?.on("data", (buffer: Buffer) => stdoutBuffers.push(buffer));
		child.stderr?.on("data", (buffer: Buffer) => stderrBuffers.push(buffer));

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
				child.kill("SIGTERM");
				setTimeout(() => child.kill("SIGKILL"), 1000).unref();
				finalize(() =>
					reject(new Error(`Command timed out after ${options.timeout}ms: ${command}`)),
				);
			}, options.timeout);
			timer.unref();
		}

		child.once("error", (error) =>
			finalize(() => reject(new Error(`Failed to run ${command}: ${error.message}`))),
		);
		child.once("close", (code) => {
			finalize(() =>
				resolve({
					stdout: Buffer.concat(stdoutBuffers).toString("utf-8").trim(),
					stderr: Buffer.concat(stderrBuffers).toString("utf-8").trim(),
					exitCode: code,
				}),
			);
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
