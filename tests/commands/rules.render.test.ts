import { describe, expect, it } from "vitest";
import { buildRuleDetailRender, buildRulesRender } from "../../src/commands/rules.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

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
		expect(out).toContain("Rules catalog");
		expect(out).toContain("auto = aislop fix can change it");
		expect(out).toContain("impact = how strongly the finding contributes to the score");
		expect(out).toContain("Impact");
		expect(out.indexOf("AI Slop")).toBeLessThan(out.indexOf("Lint"));
		expect(out).toContain("ai-slop/swallowed-exception");
		expect(out).toContain("ai-slop/trivial-comment");
		expect(out).toMatch(/ai-slop\/swallowed-exception\s+error\s+review\s+strict/);
		expect(out).toMatch(/ai-slop\/trivial-comment\s+warn\s+auto\s+style/);
		expect(out).toContain("Catch block hides an error without handling it.");
		expect(out).toMatch(/lint\/no-any\s+warn/);
	});

	it("shows auto vs review fix mode", () => {
		const out = strip(
			buildRulesRender({
				rules: [
					{ id: "lint/a", engine: "lint", severity: "warning", fixable: true },
					{ id: "lint/b", engine: "lint", severity: "warning", fixable: false },
				],
			}),
		);
		expect(out).toContain("auto");
		expect(out).toContain("review");
	});

	it("ends with accent-green next-step hints pointing at scan and init", () => {
		const out = strip(
			buildRulesRender({
				rules: [{ id: "lint/a", engine: "lint", severity: "warning", fixable: true }],
				invocation: "aislop",
			}),
		);
		// Symbols vary between TTY (→) and non-TTY/plain (->); both forms should
		// carry the scan and init hints.
		expect(out).toMatch(/(→|->) Run aislop scan to check your project against these rules/);
		expect(out).toMatch(/(→|->) Run aislop init to choose engines and CI settings/);
	});

	it("renders a rule detail card with meaning and fix guidance", () => {
		const out = strip(
			buildRuleDetailRender(
				{
					id: "ai-slop/console-leftover",
					engine: "ai-slop",
					severity: "warning",
					fixable: false,
				},
				{ includeHeader: false },
			),
		);

		expect(out).toContain("Rule");
		expect(out).toContain("ai-slop/console-leftover");
		expect(out).toContain("AI Slop");
		expect(out).toContain("review");
		expect(out).toContain("Impact");
		expect(out).toContain("style");
		expect(out).toContain("Leftover debug output is visible cleanup");
		expect(out).toContain("console/debug output was left in application code.");
	});
});
