import { describe, expect, it } from "vitest";
import type { Diagnostic, EngineResult } from "../../src/engines/types.js";
import { buildSarifLog } from "../../src/output/sarif.js";

const createDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
	filePath: "src/example.ts",
	engine: "ai-slop",
	rule: "ai-slop/narrative-comment",
	severity: "warning",
	message: "Narrative comment",
	help: "Remove the comment",
	line: 12,
	column: 3,
	category: "comments",
	fixable: true,
	...overrides,
});

const createResult = (diagnostics: Diagnostic[]): EngineResult => ({
	engine: "ai-slop",
	diagnostics,
	elapsed: 1,
	skipped: false,
});

describe("buildSarifLog", () => {
	it("produces a valid SARIF 2.1.0 skeleton with the aislop driver", () => {
		const log = buildSarifLog([createResult([createDiagnostic()])]);

		expect(log.version).toBe("2.1.0");
		expect(log.runs).toHaveLength(1);
		expect(log.runs[0]?.tool.driver.name).toBe("aislop");
	});

	it("maps severity to SARIF level", () => {
		const log = buildSarifLog([
			createResult([
				createDiagnostic({ severity: "error", rule: "security/hardcoded-secret" }),
				createDiagnostic({ severity: "warning", rule: "ai-slop/narrative-comment" }),
				createDiagnostic({ severity: "info", rule: "code-quality/unused-declaration" }),
			]),
		]);

		const levels = log.runs[0]?.results.map((r) => r.level);
		expect(levels).toEqual(["error", "warning", "note"]);
	});

	it("dedupes rules and links results via ruleIndex", () => {
		const log = buildSarifLog([
			createResult([
				createDiagnostic({ line: 1 }),
				createDiagnostic({ line: 2 }),
				createDiagnostic({ rule: "security/hardcoded-secret", severity: "error" }),
			]),
		]);

		const rules = log.runs[0]?.tool.driver.rules ?? [];
		expect(rules.map((r) => r.id)).toEqual([
			"ai-slop/narrative-comment",
			"security/hardcoded-secret",
		]);
		expect(log.runs[0]?.results[2]?.ruleIndex).toBe(1);
	});

	it("emits a 1-based physical location", () => {
		const log = buildSarifLog([
			createResult([createDiagnostic({ filePath: "src/a/b.ts", line: 0, column: 0 })]),
		]);

		const region = log.runs[0]?.results[0]?.locations[0]?.physicalLocation.region;
		const uri = log.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri;
		expect(uri).toBe("src/a/b.ts");
		expect(region).toEqual({ startLine: 1, startColumn: 1 });
	});
});
