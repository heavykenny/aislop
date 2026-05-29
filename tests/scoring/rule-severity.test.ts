import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../src/engines/types.js";
import { applyRuleSeverities } from "../../src/scoring/rule-severity.js";

const createDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
	filePath: "src/example.ts",
	engine: "ai-slop",
	rule: "ai-slop/narrative-comment",
	severity: "warning",
	message: "Narrative comment",
	help: "Remove the comment",
	line: 1,
	column: 1,
	category: "comments",
	fixable: true,
	...overrides,
});

describe("applyRuleSeverities", () => {
	it("returns diagnostics untouched when no overrides are set", () => {
		const diagnostics = [createDiagnostic()];
		expect(applyRuleSeverities(diagnostics, {})).toBe(diagnostics);
	});

	it("drops diagnostics for rules set to off", () => {
		const diagnostics = [
			createDiagnostic({ rule: "ai-slop/todo-stub" }),
			createDiagnostic({ rule: "ai-slop/narrative-comment" }),
		];
		const result = applyRuleSeverities(diagnostics, { "ai-slop/todo-stub": "off" });
		expect(result.map((d) => d.rule)).toEqual(["ai-slop/narrative-comment"]);
	});

	it("rewrites severity for overridden rules", () => {
		const diagnostics = [createDiagnostic({ severity: "warning" })];
		const result = applyRuleSeverities(diagnostics, {
			"ai-slop/narrative-comment": "error",
		});
		expect(result[0]?.severity).toBe("error");
	});

	it("leaves unmatched rules at their original severity", () => {
		const diagnostics = [
			createDiagnostic({ rule: "security/hardcoded-secret", severity: "error" }),
		];
		const result = applyRuleSeverities(diagnostics, {
			"ai-slop/narrative-comment": "off",
		});
		expect(result[0]?.severity).toBe("error");
	});
});
