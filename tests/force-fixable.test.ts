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
	it("flags npm/pnpm dependency vulnerabilities", () => {
		expect(isForceFixable(diag({ detail: "npm" }))).toBe(true);
		expect(isForceFixable(diag({ detail: "pnpm" }))).toBe(true);
	});

	it("does NOT flag non-JS dependency vulnerabilities (pip/go/cargo have no fix -f path)", () => {
		expect(isForceFixable(diag({ detail: undefined }))).toBe(false);
	});

	it("flags knip unused files/deps as force-fixable", () => {
		expect(isForceFixable(diag({ engine: "code-quality", rule: "knip/files" }))).toBe(true);
	});

	it("flags expo dependency-alignment findings but not config errors", () => {
		expect(
			isForceFixable(diag({ engine: "lint", rule: "expo-doctor/check-dependency-versions" })),
		).toBe(true);
		expect(isForceFixable(diag({ engine: "lint", rule: "expo-doctor/config-error" }))).toBe(false);
	});

	it("does not flag a normally auto-fixable finding", () => {
		expect(
			isForceFixable(diag({ engine: "ai-slop", rule: "ai-slop/unused-import", fixable: true })),
		).toBe(false);
	});

	it("exposes forceFixable on assessed diagnostics for JSON output", () => {
		const [assessed] = withFindingAssessments([diag({ detail: "npm" })]);
		expect(assessed.forceFixable).toBe(true);
	});
});
