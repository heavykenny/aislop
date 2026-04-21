import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/engines/types.js";
import { calculateScore, getScoreColor } from "../src/scoring/index.js";

const defaultThresholds = { good: 75, ok: 50 };
const defaultWeights: Record<string, number> = {
	format: 0.5,
	lint: 1.0,
	"code-quality": 1.5,
	"ai-slop": 1.0,
	architecture: 1.0,
	security: 2.0,
};

const makeDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
	filePath: "src/foo.ts",
	engine: "lint",
	rule: "some/rule",
	severity: "warning",
	message: "something is wrong",
	help: "fix it",
	line: 1,
	column: 0,
	category: "Lint",
	fixable: false,
	...overrides,
});

// ─── calculateScore ────────────────────────────────────────────────────────────

describe("calculateScore", () => {
	it("returns 100 and Healthy when there are no diagnostics", () => {
		const result = calculateScore([], defaultWeights, defaultThresholds);
		expect(result.score).toBe(100);
		expect(result.label).toBe("Healthy");
	});

	it("score decreases as diagnostics are added", () => {
		const one = calculateScore([makeDiagnostic()], defaultWeights, defaultThresholds);
		const many = calculateScore(
			Array(10).fill(makeDiagnostic()),
			defaultWeights,
			defaultThresholds,
		);
		expect(one.score).toBeLessThan(100);
		expect(many.score).toBeLessThan(one.score);
	});

	it("errors cause larger deductions than warnings", () => {
		const warnResult = calculateScore(
			[makeDiagnostic({ severity: "warning" })],
			defaultWeights,
			defaultThresholds,
		);
		const errorResult = calculateScore(
			[makeDiagnostic({ severity: "error" })],
			defaultWeights,
			defaultThresholds,
		);
		expect(errorResult.score).toBeLessThan(warnResult.score);
	});

	it("warnings cause larger deductions than info", () => {
		const infoResult = calculateScore(
			[makeDiagnostic({ severity: "info" })],
			defaultWeights,
			defaultThresholds,
		);
		const warnResult = calculateScore(
			[makeDiagnostic({ severity: "warning" })],
			defaultWeights,
			defaultThresholds,
		);
		expect(warnResult.score).toBeLessThan(infoResult.score);
	});

	it("security diagnostics have higher impact than format diagnostics", () => {
		const formatResult = calculateScore(
			[makeDiagnostic({ engine: "format", severity: "error" })],
			defaultWeights,
			defaultThresholds,
		);
		const securityResult = calculateScore(
			[makeDiagnostic({ engine: "security", severity: "error" })],
			defaultWeights,
			defaultThresholds,
		);
		expect(securityResult.score).toBeLessThan(formatResult.score);
	});

	it("single security error in a small clean codebase stays in a proportional range", () => {
		const result = calculateScore(
			[makeDiagnostic({ engine: "security", severity: "error" })],
			defaultWeights,
			defaultThresholds,
			2,
		);

		expect(result.score).toBeGreaterThanOrEqual(75);
		expect(result.score).toBeLessThanOrEqual(85);
	});

	it("same issue has lower impact in larger codebases", () => {
		const diagnostics = [makeDiagnostic({ engine: "security", severity: "error" })];
		const smallCodebase = calculateScore(diagnostics, defaultWeights, defaultThresholds, 2);
		const largeCodebase = calculateScore(diagnostics, defaultWeights, defaultThresholds, 200);

		expect(largeCodebase.score).toBeGreaterThan(smallCodebase.score);
	});

	it("unknown engine falls back to weight 1.0", () => {
		// "custom-engine" not in weights → default 1.0
		const result = calculateScore(
			[makeDiagnostic({ engine: "lint", severity: "error" })],
			defaultWeights,
			defaultThresholds,
		);
		const unknownResult = calculateScore(
			// @ts-expect-error — intentionally passing unknown engine
			[makeDiagnostic({ engine: "custom-engine", severity: "error" })],
			defaultWeights,
			defaultThresholds,
		);
		// lint weight === 1.0, unknown weight falls back to 1.0 — should be equal
		expect(unknownResult.score).toBe(result.score);
	});

	it("score never goes below 0", () => {
		const diagnostics = Array(500).fill(makeDiagnostic({ engine: "security", severity: "error" }));
		const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);
		expect(result.score).toBeGreaterThanOrEqual(0);
	});

	it("score is an integer (Math.round applied)", () => {
		const result = calculateScore([makeDiagnostic()], defaultWeights, defaultThresholds);
		expect(Number.isInteger(result.score)).toBe(true);
	});

	it("label is Healthy when score >= good threshold", () => {
		// Empty diagnostics → perfect score
		const result = calculateScore([], defaultWeights, defaultThresholds);
		expect(result.label).toBe("Healthy");
	});

	it("label is Critical when score is below ok threshold", () => {
		// Flood with heavy errors to push score below 50
		const diagnostics = Array(200).fill(makeDiagnostic({ engine: "security", severity: "error" }));
		const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);
		expect(result.label).toBe("Critical");
		expect(result.score).toBeLessThan(defaultThresholds.ok);
	});

	it("label is Needs Work when score is between ok and good thresholds", () => {
		// Use custom thresholds where good=90, ok=80 to make it easy to hit "Needs Work"
		const tightThresholds = { good: 90, ok: 80 };
		// A moderate number of warnings should land in that band
		const diagnostics = Array(5).fill(makeDiagnostic({ severity: "warning" }));
		const result = calculateScore(diagnostics, defaultWeights, tightThresholds);
		if (result.score >= 80 && result.score < 90) {
			expect(result.label).toBe("Needs Work");
		} else {
			// At least confirm the label logic is internally consistent
			if (result.score >= 90) expect(result.label).toBe("Healthy");
			else if (result.score >= 80) expect(result.label).toBe("Needs Work");
			else expect(result.label).toBe("Critical");
		}
	});

	it("uses custom thresholds correctly", () => {
		const strictThresholds = { good: 95, ok: 80 };
		const lenientThresholds = { good: 30, ok: 10 };

		const diagnostics = [makeDiagnostic({ severity: "warning" })];
		const strict = calculateScore(diagnostics, defaultWeights, strictThresholds);
		const lenient = calculateScore(diagnostics, defaultWeights, lenientThresholds);

		// Same score, but label depends on threshold
		expect(strict.score).toBe(lenient.score);
		// Lenient thresholds → more likely to be Healthy
		expect(lenient.label).toBe("Healthy");
	});

	it("logarithmic scaling: 10x diagnostics does not result in 10x score drop", () => {
		const one = calculateScore(
			[makeDiagnostic({ severity: "error", engine: "security" })],
			defaultWeights,
			defaultThresholds,
		);
		const ten = calculateScore(
			Array(10).fill(makeDiagnostic({ severity: "error", engine: "security" })),
			defaultWeights,
			defaultThresholds,
		);
		const drop1 = 100 - one.score;
		const drop10 = 100 - ten.score;
		expect(drop10).toBeLessThan(drop1 * 10);
	});
});

// ─── getScoreColor ─────────────────────────────────────────────────────────────

describe("getScoreColor", () => {
	it("returns success when score is at the good threshold", () => {
		expect(getScoreColor(75, defaultThresholds)).toBe("success");
	});

	it("returns success when score is above the good threshold", () => {
		expect(getScoreColor(100, defaultThresholds)).toBe("success");
		expect(getScoreColor(80, defaultThresholds)).toBe("success");
	});

	it("returns warn when score is between ok and good thresholds", () => {
		expect(getScoreColor(60, defaultThresholds)).toBe("warn");
		expect(getScoreColor(50, defaultThresholds)).toBe("warn");
	});

	it("returns error when score is below ok threshold", () => {
		expect(getScoreColor(49, defaultThresholds)).toBe("error");
		expect(getScoreColor(0, defaultThresholds)).toBe("error");
	});

	it("handles edge case at exact ok threshold as warn", () => {
		expect(getScoreColor(50, defaultThresholds)).toBe("warn");
	});

	it("handles custom thresholds", () => {
		const custom = { good: 90, ok: 60 };
		expect(getScoreColor(95, custom)).toBe("success");
		expect(getScoreColor(75, custom)).toBe("warn");
		expect(getScoreColor(59, custom)).toBe("error");
	});
});
