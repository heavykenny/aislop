import { describe, expect, it } from "vitest";
import {
	type AgentProvider,
	type ProviderStatus,
	PROVIDERS,
	resolveProvider,
} from "../../src/agents/providers.js";

const status = (
	provider: AgentProvider,
	overrides: Partial<ProviderStatus> = {},
): ProviderStatus => ({
	provider,
	installed: false,
	authenticated: null,
	version: null,
	authHint: null,
	...overrides,
});

describe("agent providers", () => {
	it("builds headless commands for supported providers", () => {
		const codex = PROVIDERS.find((provider) => provider.id === "codex");
		const claude = PROVIDERS.find((provider) => provider.id === "claude");
		const opencode = PROVIDERS.find((provider) => provider.id === "opencode");

		expect(codex?.buildArgs("repair", { maxTurns: 3 })).toEqual(["exec", "--json", "repair"]);
		expect(claude?.buildArgs("repair", { maxTurns: 3 })).toEqual([
			"-p",
			"--output-format",
			"stream-json",
			"--max-turns",
			"3",
			"repair",
		]);
		expect(opencode?.buildArgs("repair", { maxTurns: 3 })).toEqual(["run", "repair"]);
	});

	it("defines local connect commands without API-key handling", () => {
		const codex = PROVIDERS.find((provider) => provider.id === "codex");
		const claude = PROVIDERS.find((provider) => provider.id === "claude");
		const opencode = PROVIDERS.find((provider) => provider.id === "opencode");

		expect(codex?.loginCommand).toEqual({ command: "codex", args: ["login"] });
		expect(claude?.loginCommand).toEqual({ command: "claude", args: ["auth", "login"] });
		expect(opencode?.loginCommand).toEqual({
			command: "opencode",
			args: ["auth", "login"],
		});
	});

	it("auto-selects the first installed and authenticated provider", () => {
		const [codex, claude, opencode] = PROVIDERS;
		const selected = resolveProvider("auto", [
			status(codex, { installed: false }),
			status(claude, { installed: true, authenticated: false }),
			status(opencode, { installed: true, authenticated: null }),
		]);

		expect(selected?.provider.id).toBe("opencode");
	});

	it("allows explicit provider switching", () => {
		const [codex, claude, opencode] = PROVIDERS;
		const selected = resolveProvider("claude", [
			status(codex, { installed: true }),
			status(claude, { installed: true }),
			status(opencode, { installed: true }),
		]);

		expect(selected?.provider.id).toBe("claude");
	});
});
