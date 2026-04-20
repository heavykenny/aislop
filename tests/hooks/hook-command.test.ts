import { describe, expect, it } from "vitest";
import {
	defaultInstallTargets,
	parseAgentFlag,
} from "../../src/commands/hook.js";

describe("parseAgentFlag", () => {
	it("returns the fallback when no arg is provided", () => {
		const fallback = defaultInstallTargets();
		expect(parseAgentFlag(undefined, fallback)).toEqual(fallback);
	});

	it("parses a single agent", () => {
		expect(parseAgentFlag("claude", [])).toEqual(["claude"]);
	});

	it("parses a comma-separated list and trims whitespace", () => {
		expect(parseAgentFlag("claude, cursor ,gemini", [])).toEqual([
			"claude",
			"cursor",
			"gemini",
		]);
	});

	it("drops empty segments from the list", () => {
		expect(parseAgentFlag("claude,,cursor", [])).toEqual(["claude", "cursor"]);
	});

	it("throws on an unknown agent name", () => {
		expect(() => parseAgentFlag("claude,nope", [])).toThrowError(
			/Unknown agent/,
		);
	});

	it("throws naming every unknown agent at once", () => {
		expect(() => parseAgentFlag("claude,nope,also-nope", [])).toThrowError(
			/nope, also-nope/,
		);
	});
});

describe("defaultInstallTargets", () => {
	it("returns the both-scope agent list by default", () => {
		const targets = defaultInstallTargets();
		expect(targets).toContain("claude");
		expect(targets).toContain("cursor");
		expect(targets).toContain("gemini");
		expect(targets).toContain("codex");
		// Project-only agents require explicit opt-in
		expect(targets).not.toContain("windsurf");
		expect(targets).not.toContain("copilot");
	});
});
