import { spawn } from "node:child_process";
import type { AgentProvider, AgentProviderId } from "./providers.js";

class ProviderExitError extends Error {
	readonly name = "ProviderExitError";

	constructor(
		readonly providerId: AgentProviderId,
		providerLabel: string,
		readonly exitCode: number | null,
	) {
		super(
			exitCode === null
				? `${providerLabel} exited without reporting a status code.`
				: `${providerLabel} exited with code ${exitCode}.`,
		);
	}
}

interface ProviderRunEvent {
	stream: "stdout" | "stderr";
	line: string;
}

export const runProvider = (
	provider: AgentProvider,
	input: {
		cwd: string;
		prompt: string;
		maxTurns: number;
		onEvent?: (event: ProviderRunEvent) => void;
	},
): Promise<number | null> =>
	new Promise((resolve, reject) => {
		const child = spawn(
			provider.bin,
			provider.buildArgs(input.prompt, { maxTurns: input.maxTurns }),
			{
				cwd: input.cwd,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, NO_COLOR: "1" },
			},
		);

		const flushLine = (stream: "stdout" | "stderr") => {
			let buffer = "";
			return (chunk: Buffer) => {
				buffer += chunk.toString("utf-8");
				let newline = buffer.indexOf("\n");
				while (newline >= 0) {
					const line = buffer.slice(0, newline).trimEnd();
					buffer = buffer.slice(newline + 1);
					if (line.trim().length > 0) input.onEvent?.({ stream, line });
					newline = buffer.indexOf("\n");
				}
			};
		};

		child.stdout?.on("data", flushLine("stdout"));
		child.stderr?.on("data", flushLine("stderr"));
		child.once("error", (error) => reject(error));
		child.once("close", (code) => {
			if (code === 0) {
				resolve(code);
				return;
			}
			reject(new ProviderExitError(provider.id, provider.label, code));
		});
	});
