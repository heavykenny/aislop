import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/engines/types.js";
import { isForceFixable, withFindingAssessments } from "../src/output/finding-assessment.js";

const diag = (over: Partial<Diagnostic>): Diagnostic => ({
	filePath: "package.json",
	engine: "security",
	rule: "security/vulnerable-dependency",
	severity: "warning",
	message: "",
	help: "",
	line: 0,
	column: 0,
	category: "Security",
	fixable: false,
	...over,
});

describe("isForceFixable", () => {
	it("flags dependency vulnerabilities (fix -f only) as force-fixable", () => {
		expect(isForceFixable(diag({}))).toBe(true);
	});

	it("flags knip unused files/deps as force-fixable", () => {
		expect(isForceFixable(diag({ engine: "code-quality", rule: "knip/files" }))).toBe(true);
	});

	it("does not flag a normally auto-fixable finding", () => {
		expect(
			isForceFixable(diag({ engine: "ai-slop", rule: "ai-slop/unused-import", fixable: true })),
		).toBe(false);
	});

	it("exposes forceFixable on assessed diagnostics for JSON output", () => {
		const [assessed] = withFindingAssessments([diag({})]);
		expect(assessed.forceFixable).toBe(true);
	});
});
