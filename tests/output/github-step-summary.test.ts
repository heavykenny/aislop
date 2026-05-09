import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Diagnostic } from "../../src/engines/types.js";
import { writeGitHubStepSummary } from "../../src/output/github-step-summary.js";

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

let tmpFile: string;
let originalEnv: string | undefined;

describe("writeGitHubStepSummary", () => {
	beforeEach(() => {
		tmpFile = path.join(os.tmpdir(), `aislop-step-summary-${Date.now()}-${Math.random()}.md`);
		originalEnv = process.env.GITHUB_STEP_SUMMARY;
	});

	afterEach(() => {
		if (originalEnv === undefined) delete process.env.GITHUB_STEP_SUMMARY;
		else process.env.GITHUB_STEP_SUMMARY = originalEnv;
		if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
	});

	it("no-ops when GITHUB_STEP_SUMMARY env var is unset", () => {
		delete process.env.GITHUB_STEP_SUMMARY;
		writeGitHubStepSummary([], { score: 100, label: "Healthy" }, 5);
		expect(fs.existsSync(tmpFile)).toBe(false);
	});

	it("writes a header with score, label, and counts", () => {
		process.env.GITHUB_STEP_SUMMARY = tmpFile;
		writeGitHubStepSummary([], { score: 95, label: "Healthy" }, 12);
		const out = fs.readFileSync(tmpFile, "utf8");
		expect(out).toContain("aislop · 95 / 100 · Healthy");
		expect(out).toContain("**12 files**");
		expect(out).toContain("**0 errors**");
		expect(out).toContain("**0 warnings**");
	});

	it("emits a clean-run line when there are no findings", () => {
		process.env.GITHUB_STEP_SUMMARY = tmpFile;
		writeGitHubStepSummary([], { score: 100, label: "Healthy" }, 5);
		const out = fs.readFileSync(tmpFile, "utf8");
		expect(out).toContain("✓ No findings.");
		expect(out).not.toContain("| Severity | Rule");
	});

	it("renders a markdown table including the help text per finding", () => {
		process.env.GITHUB_STEP_SUMMARY = tmpFile;
		const diagnostics = [
			makeDiagnostic({
				severity: "error",
				rule: "security/vulnerable-dependency",
				message: "fast-xml-builder (high)",
				help: "Run `npx aislop fix -f` to apply this fix — Upgrade to version 1.1.7 or later",
				filePath: "package.json",
				line: 0,
			}),
			makeDiagnostic({
				severity: "warning",
				rule: "ai-slop/narrative-comment",
				message: "Narrative comment block",
				help: "Remove — narrative comments belong in PR descriptions",
			}),
		];
		writeGitHubStepSummary(diagnostics, { score: 73, label: "Needs Work" }, 5);
		const out = fs.readFileSync(tmpFile, "utf8");
		expect(out).toContain("| Severity | Rule | Location | Message | How to fix |");
		expect(out).toContain("Run `npx aislop fix -f` to apply this fix");
		expect(out).toContain("security/vulnerable-dependency");
		expect(out).toContain("ai-slop/narrative-comment");
		// Errors should sort before warnings.
		const errorIdx = out.indexOf("vulnerable-dependency");
		const warnIdx = out.indexOf("narrative-comment");
		expect(errorIdx).toBeLessThan(warnIdx);
	});

	it("escapes pipe characters in messages and locations", () => {
		process.env.GITHUB_STEP_SUMMARY = tmpFile;
		const diagnostics = [
			makeDiagnostic({
				message: "value | with pipes",
				help: "see |docs|",
			}),
		];
		writeGitHubStepSummary(diagnostics, { score: 50, label: "Needs Work" }, 1);
		const out = fs.readFileSync(tmpFile, "utf8");
		expect(out).toContain("value \\| with pipes");
		expect(out).toContain("see \\|docs\\|");
	});

	it("uses an em-dash placeholder when help is missing", () => {
		process.env.GITHUB_STEP_SUMMARY = tmpFile;
		const diagnostics = [makeDiagnostic({ help: "" })];
		writeGitHubStepSummary(diagnostics, { score: 90, label: "Healthy" }, 1);
		const out = fs.readFileSync(tmpFile, "utf8");
		// The "How to fix" column should show — for findings without help text.
		expect(out).toMatch(/\| —\s*\|/);
	});

	it("caps the table at 50 findings and reports the overflow", () => {
		process.env.GITHUB_STEP_SUMMARY = tmpFile;
		const diagnostics = Array.from({ length: 75 }, (_, i) =>
			makeDiagnostic({ rule: `rule-${i}`, message: `finding ${i}` }),
		);
		writeGitHubStepSummary(diagnostics, { score: 30, label: "Critical" }, 75);
		const out = fs.readFileSync(tmpFile, "utf8");
		expect(out).toContain("rule-0");
		expect(out).not.toContain("rule-50"); // 50 is the 51st item, off the end
		expect(out).toContain("+25 more findings");
	});

	it("does not throw when the summary file cannot be written", () => {
		process.env.GITHUB_STEP_SUMMARY = "/nonexistent-dir-that-cannot-exist/summary.md";
		expect(() =>
			writeGitHubStepSummary([], { score: 100, label: "Healthy" }, 1),
		).not.toThrow();
	});
});
