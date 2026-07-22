import { describe, expect, it } from "vitest";
import { runProvider } from "../../src/agents/provider-runner.js";
import type { AgentProvider } from "../../src/agents/providers.js";

const providerWithExitCode = (exitCode: number): AgentProvider => ({
	id: "opencode",
	label: "OpenCode",
	bin: process.execPath,
	loginCommand: { command: "opencode", args: ["auth", "login"] },
	loginHint: "Run `opencode auth login`.",
	buildArgs: () => ["-e", `process.exitCode = ${exitCode}`],
});

describe("provider runner", () => {
	it("resolves when the provider process exits successfully", async () => {
		await expect(
			runProvider(providerWithExitCode(0), {
				cwd: process.cwd(),
				prompt: "repair",
				maxTurns: 1,
			}),
		).resolves.toBe(0);
	});

	it("rejects when the provider process exits non-zero", async () => {
		await expect(
			runProvider(providerWithExitCode(7), {
				cwd: process.cwd(),
				prompt: "repair",
				maxTurns: 1,
			}),
		).rejects.toMatchObject({
			name: "ProviderExitError",
			providerId: "opencode",
			exitCode: 7,
		});
	});
});
