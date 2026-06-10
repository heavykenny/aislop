import { describe, expect, it } from "vitest";
import { PROVIDERS, type ProviderStatus } from "../../src/agents/providers.js";
import { renderAgentProviders } from "../../src/commands/agent-providers.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

const providerStatus = (index: number, overrides: Partial<ProviderStatus>): ProviderStatus => ({
	provider: PROVIDERS[index],
	installed: true,
	authenticated: true,
	version: null,
	authHint: null,
	...overrides,
});

describe("agent providers render", () => {
	it("uses reusable sections and aligned rows", () => {
		const out = strip(
			renderAgentProviders({
				preference: "codex",
				statuses: [
					providerStatus(0, { version: "codex-cli 0.134.0" }),
					providerStatus(1, {
						authenticated: false,
						version: "2.1.165 (Claude Code)",
						authHint: "Run `claude auth login`.",
					}),
					providerStatus(2, { installed: false, authenticated: false }),
				],
			}),
		);

		expect(out).toContain("Agent providers");
		expect(out).toContain("Default");
		expect(out).toMatch(/Provider\s+Codex \(codex\)/);
		expect(out).toContain("Providers");
		expect(out).toMatch(/✓ Codex/);
		expect(out).toMatch(/!\s+Claude Code/);
		expect(out).toMatch(/· OpenCode/);
		expect(out).toMatch(/Status\s+ready/);
		expect(out).toMatch(/Status\s+installed, auth needed/);
		expect(out).toMatch(/Status\s+not installed/);
		expect(out).toMatch(/Version\s+codex-cli 0\.134\.0/);
		expect(out).toMatch(/Connect\s+aislop agent connect codex/);
		expect(out).toContain("Actions");
		expect(out).toMatch(/Switch\s+aislop agent --provider <codex\|claude\|opencode\|auto>/);
		expect(out).toMatch(/Save\s+aislop agent use <provider\|auto>/);
		expect(out).not.toContain("\n\n\n");

		const lines = out.split("\n");
		const statusLine = lines.find((line) => line.includes("Status") && line.includes("ready"));
		const connectLine = lines.find((line) => line.includes("Connect") && line.includes("codex"));
		expect(statusLine?.indexOf("ready")).toBe(connectLine?.indexOf("aislop agent connect codex"));
	});
});
