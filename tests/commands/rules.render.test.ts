import { describe, expect, it } from "vitest";
import { buildRulesRender } from "../../src/commands/rules.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI_RE, "");

describe("rules render", () => {
	it("groups rules by engine, sorted by id", () => {
		const out = strip(
			buildRulesRender({
				rules: [
					{ id: "ai-slop/trivial-comment", engine: "ai-slop", severity: "warning", fixable: true },
					{
						id: "ai-slop/swallowed-exception",
						engine: "ai-slop",
						severity: "error",
						fixable: false,
					},
					{ id: "lint/no-any", engine: "lint", severity: "warning", fixable: false },
				],
			}),
		);
		expect(out.indexOf("ai-slop")).toBeLessThan(out.indexOf("lint"));
		expect(out).toContain("ai-slop/swallowed-exception");
		expect(out).toContain("ai-slop/trivial-comment");
		expect(out).toMatch(/lint\/no-any\s+warning/);
	});

	it("shows fixable vs manual column", () => {
		const out = strip(
			buildRulesRender({
				rules: [
					{ id: "lint/a", engine: "lint", severity: "warning", fixable: true },
					{ id: "lint/b", engine: "lint", severity: "warning", fixable: false },
				],
			}),
		);
		expect(out).toContain("fixable");
		expect(out).toContain("manual");
	});

	it("ends with accent-green next-step hints pointing at scan and init", () => {
		const out = strip(
			buildRulesRender({
				rules: [{ id: "lint/a", engine: "lint", severity: "warning", fixable: true }],
				invocation: "npx aislop",
			}),
		);
		// Symbols vary between TTY (→) and non-TTY/plain (->); both forms should
		// carry the scan and init hints.
		expect(out).toMatch(/(→|->) Run npx aislop scan to apply these rules/);
		expect(out).toMatch(/(→|->) Run npx aislop init to customize which engines are enabled/);
	});
});
