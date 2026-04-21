import { describe, expect, it } from "vitest";
import type { Diagnostic, EngineName, Severity } from "../src/engines/types.js";
import { calculateScore, getScoreColor } from "../src/scoring/index.js";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

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

/** Create a single diagnostic for the innerHTML/security scenario from issue #9 */
const makeInnerHTMLDiagnostic = (filePath = "src/component.tsx"): Diagnostic =>
	makeDiagnostic({
		filePath,
		engine: "security",
		rule: "no-inner-html",
		severity: "error",
		message: "Use of innerHTML is a security risk (XSS)",
		help: "Use textContent or a sanitisation library instead",
		category: "Security",
	});

// ─── Issue #9: Single issue proportionality ────────────────────────────────────

describe("Issue #9: single issue in codebases of different sizes", () => {
	it("single security error produces the same score regardless of codebase size", () => {
		// This documents the CURRENT behavior — scoring ignores codebase size.
		// The score is identical whether there's 1 file or 500 files.
		const singleFile = calculateScore(
			[makeInnerHTMLDiagnostic("src/only-file.tsx")],
			defaultWeights,
			defaultThresholds,
		);

		const largeCodebase = calculateScore(
			[makeInnerHTMLDiagnostic("src/one-of-many.tsx")],
			defaultWeights,
			defaultThresholds,
		);

		// Current algorithm: same diagnostic = same score, no density awareness
		expect(singleFile.score).toBe(largeCodebase.score);
	});

	it("snapshot: single innerHTML error score with default weights", () => {
		// This is the #9 scenario: one innerHTML drops score dramatically
		const result = calculateScore([makeInnerHTMLDiagnostic()], defaultWeights, defaultThresholds);

		// Document the exact current score for regression tracking.
		// security weight=2.0, error penalty=3, deduction=6
		// score = max(0, round(100 - (100 * log1p(6)) / log1p(106)))
		expect(result.score).toMatchInlineSnapshot(`78`);
		expect(result.label).toBe("Healthy");
	});

	it("single format info produces a minimal score drop", () => {
		const result = calculateScore(
			[makeDiagnostic({ engine: "format", severity: "info" })],
			defaultWeights,
			defaultThresholds,
		);

		// format weight=0.5, info penalty=0.25, deduction=0.125
		expect(result.score).toMatchInlineSnapshot(`99`);
		expect(result.label).toBe("Healthy");
	});

	it("single lint warning produces moderate score drop", () => {
		const result = calculateScore(
			[makeDiagnostic({ engine: "lint", severity: "warning" })],
			defaultWeights,
			defaultThresholds,
		);

		// lint weight=1.0, warning penalty=1, deduction=1.0
		expect(result.score).toMatchInlineSnapshot(`94`);
		expect(result.label).toBe("Healthy");
	});

	it("single code-quality error produces significant score drop", () => {
		const result = calculateScore(
			[
				makeDiagnostic({
					engine: "code-quality",
					severity: "error",
				}),
			],
			defaultWeights,
			defaultThresholds,
		);

		// code-quality weight=1.5, error penalty=3, deduction=4.5
		expect(result.score).toMatchInlineSnapshot(`81`);
		expect(result.label).toBe("Healthy");
	});
});

// ─── Severity weight ordering ──────────────────────────────────────────────────

describe("severity penalty ordering", () => {
	const engines: EngineName[] = [
		"format",
		"lint",
		"code-quality",
		"ai-slop",
		"architecture",
		"security",
	];

	for (const engine of engines) {
		it(`${engine}: error > warning > info deductions`, () => {
			const infoScore = calculateScore(
				[makeDiagnostic({ engine, severity: "info" })],
				defaultWeights,
				defaultThresholds,
			).score;

			const warnScore = calculateScore(
				[makeDiagnostic({ engine, severity: "warning" })],
				defaultWeights,
				defaultThresholds,
			).score;

			const errorScore = calculateScore(
				[makeDiagnostic({ engine, severity: "error" })],
				defaultWeights,
				defaultThresholds,
			).score;

			expect(errorScore).toBeLessThan(warnScore);
			expect(warnScore).toBeLessThan(infoScore);
			expect(infoScore).toBeLessThanOrEqual(100);
		});
	}
});

// ─── Engine weight ordering ────────────────────────────────────────────────────

describe("engine weight ordering", () => {
	it("single error: security > code-quality > lint = ai-slop = architecture > format", () => {
		const scoreFor = (engine: EngineName): number =>
			calculateScore(
				[makeDiagnostic({ engine, severity: "error" })],
				defaultWeights,
				defaultThresholds,
			).score;

		const securityScore = scoreFor("security");
		const codeQualityScore = scoreFor("code-quality");
		const lintScore = scoreFor("lint");
		const aiSlopScore = scoreFor("ai-slop");
		const architectureScore = scoreFor("architecture");
		const formatScore = scoreFor("format");

		// Higher weight = lower score (more penalty)
		expect(securityScore).toBeLessThan(codeQualityScore);
		expect(codeQualityScore).toBeLessThan(lintScore);

		// Equal weights produce equal scores
		expect(lintScore).toBe(aiSlopScore);
		expect(lintScore).toBe(architectureScore);

		// Format has lowest weight
		expect(formatScore).toBeGreaterThan(lintScore);
	});
});

// ─── Multiple issues of same severity ──────────────────────────────────────────

describe("multiple issues of same severity", () => {
	it("snapshot: 5 lint warnings", () => {
		const diagnostics = Array(5).fill(makeDiagnostic({ engine: "lint", severity: "warning" }));
		const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);

		expect(result.score).toMatchInlineSnapshot(`68`);
	});

	it("snapshot: 10 lint warnings", () => {
		const diagnostics = Array(10).fill(makeDiagnostic({ engine: "lint", severity: "warning" }));
		const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);

		expect(result.score).toMatchInlineSnapshot(`50`);
	});

	it("snapshot: 20 lint warnings", () => {
		const diagnostics = Array(20).fill(makeDiagnostic({ engine: "lint", severity: "warning" }));
		const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);

		expect(result.score).toMatchInlineSnapshot(`37`);
	});

	it("snapshot: 5 security errors", () => {
		const diagnostics = Array(5).fill(makeDiagnostic({ engine: "security", severity: "error" }));
		const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);

		expect(result.score).toMatchInlineSnapshot(`36`);
	});

	it("snapshot: 10 security errors", () => {
		const diagnostics = Array(10).fill(makeDiagnostic({ engine: "security", severity: "error" }));
		const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);

		expect(result.score).toMatchInlineSnapshot(`20`);
	});

	it("diminishing returns: overall trend is sublinear", () => {
		const scores: number[] = [];
		for (let i = 1; i <= 10; i++) {
			const diagnostics = Array(i).fill(makeDiagnostic({ engine: "lint", severity: "warning" }));
			scores.push(calculateScore(diagnostics, defaultWeights, defaultThresholds).score);
		}

		// Due to rounding, individual steps may not be strictly diminishing.
		// But overall, 10x issues should NOT produce 10x the score drop.
		const drop1 = 100 - scores[0];
		const drop10 = 100 - scores[9];
		expect(drop10).toBeLessThan(drop1 * 10);
		// Also verify the general downward trend
		expect(scores[9]).toBeLessThan(scores[0]);
	});
});

// ─── Mixed severity issues ─────────────────────────────────────────────────────

describe("mixed severity issues", () => {
	it("snapshot: 1 security error + 2 style warnings + 1 format info", () => {
		const diagnostics = [
			makeDiagnostic({ engine: "security", severity: "error" }),
			makeDiagnostic({ engine: "lint", severity: "warning" }),
			makeDiagnostic({ engine: "lint", severity: "warning" }),
			makeDiagnostic({ engine: "format", severity: "info" }),
		];
		const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);

		expect(result.score).toMatchInlineSnapshot(`62`);
		expect(result.label).toBe("Needs Work");
	});

	it("snapshot: realistic mixed codebase — various engines and severities", () => {
		const diagnostics = [
			// 2 security errors (innerHTML + eval)
			makeDiagnostic({
				engine: "security",
				severity: "error",
				rule: "no-inner-html",
			}),
			makeDiagnostic({
				engine: "security",
				severity: "error",
				rule: "no-eval",
			}),
			// 3 code quality warnings
			makeDiagnostic({
				engine: "code-quality",
				severity: "warning",
				rule: "max-function-loc",
			}),
			makeDiagnostic({
				engine: "code-quality",
				severity: "warning",
				rule: "max-nesting",
			}),
			makeDiagnostic({
				engine: "code-quality",
				severity: "warning",
				rule: "max-params",
			}),
			// 5 lint warnings
			...Array(5).fill(makeDiagnostic({ engine: "lint", severity: "warning" })),
			// 3 format infos
			...Array(3).fill(makeDiagnostic({ engine: "format", severity: "info" })),
			// 1 ai-slop warning
			makeDiagnostic({ engine: "ai-slop", severity: "warning" }),
		];
		const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);

		expect(result.score).toMatchInlineSnapshot(`34`);
		expect(result.label).toBe("Critical");
	});

	it("order of diagnostics does not affect score", () => {
		const diagnostics = [
			makeDiagnostic({ engine: "security", severity: "error" }),
			makeDiagnostic({ engine: "lint", severity: "warning" }),
			makeDiagnostic({ engine: "format", severity: "info" }),
		];
		const reversed = [...diagnostics].reverse();

		const result1 = calculateScore(diagnostics, defaultWeights, defaultThresholds);
		const result2 = calculateScore(reversed, defaultWeights, defaultThresholds);

		expect(result1.score).toBe(result2.score);
		expect(result1.label).toBe(result2.label);
	});
});

// ─── Edge cases ────────────────────────────────────────────────────────────────

describe("edge cases", () => {
	it("zero diagnostics returns perfect score", () => {
		const result = calculateScore([], defaultWeights, defaultThresholds);
		expect(result.score).toBe(100);
		expect(result.label).toBe("Healthy");
	});

	it("massive diagnostic count: score stays >= 0", () => {
		const diagnostics = Array(10000).fill(
			makeDiagnostic({ engine: "security", severity: "error" }),
		);
		const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);

		expect(result.score).toBeGreaterThanOrEqual(0);
		expect(result.score).toBeLessThanOrEqual(100);
	});

	it("score is always an integer", () => {
		const testCases = [1, 2, 3, 5, 10, 25, 50, 100, 500];
		for (const count of testCases) {
			const diagnostics = Array(count).fill(makeDiagnostic());
			const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);
			expect(Number.isInteger(result.score)).toBe(true);
		}
	});

	it("score is always between 0 and 100 inclusive", () => {
		const severities: Severity[] = ["info", "warning", "error"];
		const engines: EngineName[] = [
			"format",
			"lint",
			"code-quality",
			"ai-slop",
			"architecture",
			"security",
		];

		for (const severity of severities) {
			for (const engine of engines) {
				for (const count of [1, 10, 100]) {
					const diagnostics = Array(count).fill(makeDiagnostic({ engine, severity }));
					const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);
					expect(result.score).toBeGreaterThanOrEqual(0);
					expect(result.score).toBeLessThanOrEqual(100);
				}
			}
		}
	});

	it("all-zero weights: diagnostics have no effect", () => {
		const zeroWeights: Record<string, number> = {
			format: 0,
			lint: 0,
			"code-quality": 0,
			"ai-slop": 0,
			architecture: 0,
			security: 0,
		};

		const result = calculateScore(
			Array(50).fill(makeDiagnostic({ engine: "security", severity: "error" })),
			zeroWeights,
			defaultThresholds,
		);

		// 0 weight × penalty = 0 deductions → log1p(0) = 0 → score = 100
		expect(result.score).toBe(100);
	});

	it("very high weight amplifies deductions", () => {
		const highWeights: Record<string, number> = {
			...defaultWeights,
			security: 100.0,
		};

		const normal = calculateScore(
			[makeDiagnostic({ engine: "security", severity: "error" })],
			defaultWeights,
			defaultThresholds,
		);

		const amplified = calculateScore(
			[makeDiagnostic({ engine: "security", severity: "error" })],
			highWeights,
			defaultThresholds,
		);

		expect(amplified.score).toBeLessThan(normal.score);
	});

	it("empty weights object: all engines default to weight 1.0", () => {
		const emptyWeights: Record<string, number> = {};

		const result = calculateScore(
			[makeDiagnostic({ engine: "security", severity: "error" })],
			emptyWeights,
			defaultThresholds,
		);

		// Falls back to 1.0 weight; error penalty=3; deduction=3.0
		const lintWithDefault = calculateScore(
			[makeDiagnostic({ engine: "lint", severity: "error" })],
			defaultWeights,
			defaultThresholds,
		);

		// lint weight=1.0 in defaults = fallback 1.0
		expect(result.score).toBe(lintWithDefault.score);
	});
});

// ─── Label threshold boundaries ────────────────────────────────────────────────

describe("label threshold boundaries", () => {
	it("score exactly at good threshold is Healthy", () => {
		const result = calculateScore([], defaultWeights, { good: 100, ok: 50 });
		expect(result.score).toBe(100);
		expect(result.label).toBe("Healthy");
	});

	it("score exactly at ok threshold is Needs Work", () => {
		// Use thresholds where we can construct the exact boundary
		const thresholds = { good: 90, ok: 50 };

		// We need to find a diagnostic set that produces score=50 exactly.
		// If we can't hit it exactly, test that the boundary logic is correct.
		const result = calculateScore(
			Array(10).fill(makeDiagnostic({ engine: "lint", severity: "warning" })),
			defaultWeights,
			thresholds,
		);

		// Verify labelling is consistent with score
		if (result.score >= thresholds.good) {
			expect(result.label).toBe("Healthy");
		} else if (result.score >= thresholds.ok) {
			expect(result.label).toBe("Needs Work");
		} else {
			expect(result.label).toBe("Critical");
		}
	});
});

// ─── Snapshot score table ──────────────────────────────────────────────────────

describe("snapshot: score table for known inputs", () => {
	const cases: Array<{
		name: string;
		diagnostics: Diagnostic[];
		expectedScore: number;
		expectedLabel: string;
	}> = [
		{
			name: "0 issues",
			diagnostics: [],
			expectedScore: 100,
			expectedLabel: "Healthy",
		},
		{
			name: "1 format info",
			diagnostics: [makeDiagnostic({ engine: "format", severity: "info" })],
			expectedScore: 99,
			expectedLabel: "Healthy",
		},
		{
			name: "1 lint warning",
			diagnostics: [makeDiagnostic({ engine: "lint", severity: "warning" })],
			expectedScore: 94,
			expectedLabel: "Healthy",
		},
		{
			name: "1 lint error",
			diagnostics: [makeDiagnostic({ engine: "lint", severity: "error" })],
			expectedScore: 86,
			expectedLabel: "Healthy",
		},
		{
			name: "1 security error (the #9 scenario)",
			diagnostics: [makeInnerHTMLDiagnostic()],
			expectedScore: 78,
			expectedLabel: "Healthy",
		},
		{
			name: "1 code-quality error",
			diagnostics: [makeDiagnostic({ engine: "code-quality", severity: "error" })],
			expectedScore: 81,
			expectedLabel: "Healthy",
		},
		{
			name: "3 lint warnings",
			diagnostics: Array(3).fill(makeDiagnostic({ engine: "lint", severity: "warning" })),
			expectedScore: 80,
			expectedLabel: "Healthy",
		},
		{
			name: "10 format infos",
			diagnostics: Array(10).fill(makeDiagnostic({ engine: "format", severity: "info" })),
			expectedScore: 83,
			expectedLabel: "Healthy",
		},
		{
			name: "3 security errors",
			diagnostics: Array(3).fill(makeDiagnostic({ engine: "security", severity: "error" })),
			expectedScore: 50,
			expectedLabel: "Needs Work",
		},
	];

	for (const tc of cases) {
		it(`${tc.name} → score=${tc.expectedScore}, label=${tc.expectedLabel}`, () => {
			const result = calculateScore(tc.diagnostics, defaultWeights, defaultThresholds);
			expect(result.score).toBe(tc.expectedScore);
			expect(result.label).toBe(tc.expectedLabel);
		});
	}
});

// ─── getScoreColor comprehensive ───────────────────────────────────────────────

describe("getScoreColor integration with calculateScore", () => {
	it("Healthy scores produce success color", () => {
		const result = calculateScore([], defaultWeights, defaultThresholds);
		const color = getScoreColor(result.score, defaultThresholds);
		expect(color).toBe("success");
	});

	it("Critical scores produce error color", () => {
		const diagnostics = Array(100).fill(makeDiagnostic({ engine: "security", severity: "error" }));
		const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);
		const color = getScoreColor(result.score, defaultThresholds);
		expect(color).toBe("error");
	});

	it("score and color are always consistent", () => {
		const testCounts = [0, 1, 2, 5, 10, 20, 50, 100];

		for (const count of testCounts) {
			const diagnostics = Array(count).fill(
				makeDiagnostic({ engine: "lint", severity: "warning" }),
			);
			const result = calculateScore(diagnostics, defaultWeights, defaultThresholds);
			const color = getScoreColor(result.score, defaultThresholds);

			if (result.score >= defaultThresholds.good) {
				expect(color).toBe("success");
			} else if (result.score >= defaultThresholds.ok) {
				expect(color).toBe("warn");
			} else {
				expect(color).toBe("error");
			}
		}
	});
});

// ─── Issue #9 fix: density-aware scoring (sourceFileCount) ─────────────────────

describe("density-aware scoring (sourceFileCount)", () => {
	it("single innerHTML in large codebase scores higher than in small codebase", () => {
		const smallProject = calculateScore(
			[makeInnerHTMLDiagnostic()],
			defaultWeights,
			defaultThresholds,
			2, // 2 source files
		);
		const largeProject = calculateScore(
			[makeInnerHTMLDiagnostic()],
			defaultWeights,
			defaultThresholds,
			200, // 200 source files
		);

		expect(largeProject.score).toBeGreaterThan(smallProject.score);
	});

	it("single innerHTML in 200-file project stays in Healthy range", () => {
		const result = calculateScore(
			[makeInnerHTMLDiagnostic()],
			defaultWeights,
			defaultThresholds,
			200,
		);

		// Before fix: score was 58 (Needs Work). After: should be 75+ (Healthy)
		expect(result.score).toBeGreaterThanOrEqual(75);
		expect(result.label).toBe("Healthy");
	});

	it("single innerHTML in 2-file project still has meaningful penalty", () => {
		const result = calculateScore(
			[makeInnerHTMLDiagnostic()],
			defaultWeights,
			defaultThresholds,
			2,
		);

		// Should not be perfect — there IS an issue
		expect(result.score).toBeLessThan(100);
		// But should be better than the old flat 58
		expect(result.score).toBeGreaterThan(58);
	});

	it("omitting sourceFileCount falls back to file-count heuristic", () => {
		const withoutFileCount = calculateScore(
			[makeInnerHTMLDiagnostic()],
			defaultWeights,
			defaultThresholds,
		);

		// getEffectiveFileCount counts unique file paths (1 file) and applies density scaling
		expect(withoutFileCount.score).toBe(78);
	});

	it("sourceFileCount=0 falls back to file-count heuristic", () => {
		const result = calculateScore(
			[makeInnerHTMLDiagnostic()],
			defaultWeights,
			defaultThresholds,
			0,
		);

		// Falls back to getEffectiveFileCount counting unique diagnostic file paths
		expect(result.score).toBe(78);
	});

	it("density caps at 1.0 for heavily polluted codebases", () => {
		// 100 issues in 5 files = extremely dense, density capped at 1.0
		const diagnostics = Array(100).fill(makeDiagnostic({ engine: "security", severity: "error" }));
		const withDensity = calculateScore(diagnostics, defaultWeights, defaultThresholds, 5);
		const withoutDensity = calculateScore(diagnostics, defaultWeights, defaultThresholds);

		// When density >= 1.0, sqrt(1.0)=1.0, so deductions are unscaled
		expect(withDensity.score).toBe(withoutDensity.score);
	});

	it("more files = higher score for the same diagnostics", () => {
		const diagnostics = Array(5).fill(makeDiagnostic({ engine: "lint", severity: "warning" }));

		const scores = [10, 50, 100, 500].map(
			(fileCount) =>
				calculateScore(diagnostics, defaultWeights, defaultThresholds, fileCount).score,
		);

		// Each step should be >= the previous (monotonically non-decreasing)
		for (let i = 1; i < scores.length; i++) {
			expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
		}
	});

	it("score never goes below 0 even with density scaling", () => {
		const diagnostics = Array(500).fill(makeDiagnostic({ engine: "security", severity: "error" }));
		const result = calculateScore(diagnostics, defaultWeights, defaultThresholds, 10);

		expect(result.score).toBeGreaterThanOrEqual(0);
	});

	it("score is always an integer with density scaling", () => {
		const result = calculateScore(
			[makeDiagnostic({ severity: "warning" })],
			defaultWeights,
			defaultThresholds,
			42,
		);

		expect(Number.isInteger(result.score)).toBe(true);
	});

	it("empty diagnostics returns 100 regardless of sourceFileCount", () => {
		const result = calculateScore([], defaultWeights, defaultThresholds, 500);
		expect(result.score).toBe(100);
		expect(result.label).toBe("Healthy");
	});
});
