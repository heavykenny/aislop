import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../src/engines/types.js";
import {
	assessDiagnostic,
	summarizeFindingAssessments,
} from "../../src/output/finding-assessment.js";

const diagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
	filePath: "src/a.ts",
	engine: "lint",
	rule: "eslint/no-undef",
	severity: "error",
	message: "Example",
	help: "",
	line: 1,
	column: 0,
	category: "Lint",
	fixable: false,
	...overrides,
});

describe("finding assessment", () => {
	it("classifies known defects as confirmed defects", () => {
		const assessment = assessDiagnostic(diagnostic({ rule: "eslint/no-undef" }));
		expect(assessment).toMatchObject({
			kind: "confirmed-defect",
			confidence: "high",
		});
	});

	it("classifies innerHTML as a conservative security pattern", () => {
		const assessment = assessDiagnostic(
			diagnostic({ engine: "security", rule: "security/innerhtml" }),
		);
		expect(assessment).toMatchObject({
			kind: "conservative-security",
			confidence: "medium",
		});
	});

	it("classifies comment and complexity warnings as style or policy", () => {
		const summary = summarizeFindingAssessments([
			diagnostic({
				engine: "ai-slop",
				rule: "ai-slop/narrative-comment",
				severity: "warning",
			}),
			diagnostic({
				engine: "code-quality",
				rule: "complexity/function-too-long",
				severity: "warning",
			}),
		]);

		expect(summary.byKind["style-policy"]).toBe(2);
		expect(summary.byConfidence.medium).toBe(2);
	});

	it("classifies non-style ai-slop findings as indicators", () => {
		const assessment = assessDiagnostic(
			diagnostic({
				engine: "ai-slop",
				rule: "ai-slop/silent-recovery",
				severity: "warning",
			}),
		);
		expect(assessment.kind).toBe("ai-slop-indicator");
	});
});
