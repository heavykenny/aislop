import { describe, expect, it } from "vitest";
import type { Diagnostic, EngineResult } from "../../src/engines/types.js";
import { buildJsonOutput } from "../../src/output/json.js";
import type { Coverage } from "../../src/utils/discover.js";

const scoreable: Coverage = {
	supportedFiles: 10,
	unsupportedFiles: 0,
	dominantUnsupported: null,
	scoreable: true,
};

const diagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
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

const result = (diagnostics: Diagnostic[]): EngineResult => ({
	engine: "lint",
	diagnostics,
	elapsed: 10,
	skipped: false,
});

describe("json output", () => {
	it("includes schemaVersion and cliVersion", () => {
		const results: EngineResult[] = [];
		const out = buildJsonOutput(results, { score: 100, label: "Excellent" }, 0, 10, scoreable);
		expect(out.schemaVersion).toBe("1");
		expect(typeof out.cliVersion).toBe("string");
		expect(out.cliVersion.length).toBeGreaterThan(0);
	});

	it("preserves existing top-level fields", () => {
		const results: EngineResult[] = [];
		const out = buildJsonOutput(results, { score: 89, label: "Healthy" }, 1500, 50, scoreable);
		expect(out.score).toBe(89);
		expect(out.label).toBe("Healthy");
	});

	it("withholds the score when coverage is not scoreable", () => {
		const out = buildJsonOutput([], { score: 91, label: "Healthy" }, 10, 10, {
			supportedFiles: 2,
			unsupportedFiles: 6000,
			dominantUnsupported: "C/C++",
			scoreable: false,
		});
		expect(out.score).toBeNull();
		expect(out.scoreable).toBe(false);
		expect(out.coverage.dominantUnsupported).toBe("C/C++");
	});

	it("adds finding assessments to JSON diagnostics and summary", () => {
		const out = buildJsonOutput(
			[result([diagnostic()])],
			{ score: 50, label: "Critical" },
			10,
			10,
			scoreable,
		);

		expect(out.diagnostics[0].assessment.kind).toBe("confirmed-defect");
		expect(out.diagnostics[0].assessment.confidence).toBe("high");
		expect(out.diagnostics[0].scoreImpact.tier).toBe("strict");
		expect(out.diagnostics[0].scoreImpact.rationale).toContain("Undefined identifiers");
		expect(out.findingAssessment.byKind["confirmed-defect"]).toBe(1);
	});

	it("includes advisory score impact metadata for soft config warnings", () => {
		const out = buildJsonOutput(
			[
				result([
					diagnostic({
						engine: "ai-slop",
						rule: "ai-slop/hardcoded-url",
						severity: "warning",
					}),
				]),
			],
			{ score: 99, label: "Healthy" },
			10,
			10,
			scoreable,
		);

		expect(out.diagnostics[0].scoreImpact).toMatchObject({
			tier: "advisory",
			multiplier: 0.25,
			cap: 4,
		});
	});
});
