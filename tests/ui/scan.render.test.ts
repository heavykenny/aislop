import { describe, expect, it } from "vitest";
import { buildScanRender } from "../../src/commands/scan.js";
import type { Diagnostic, EngineResult } from "../../src/engines/types.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

const diag = (over: Partial<Diagnostic> = {}): Diagnostic => ({
	filePath: "src/a.ts",
	engine: "lint",
	rule: "lint/a",
	severity: "warning",
	message: "Example issue",
	line: 1,
	column: 1,
	category: "style",
	fixable: false,
	help: "",
	...over,
});

const engineResult = (over: Partial<EngineResult> = {}): EngineResult => ({
	engine: "lint",
	diagnostics: [],
	elapsed: 1000,
	skipped: false,
	...over,
});

describe("scan render", () => {
	it("includes header, summary with score, and next-steps when there are issues", () => {
		const out = strip(
			buildScanRender({
				projectName: "my-app",
				language: "typescript",
				fileCount: 142,
				results: [
					engineResult({ engine: "format", elapsed: 600 }),
					engineResult({ engine: "lint", elapsed: 1100, diagnostics: [diag(), diag()] }),
				],
				diagnostics: [diag(), diag({ fixable: true })],
				score: { score: 89, label: "Healthy" },
				elapsedMs: 2300,
				thresholds: { good: 85, ok: 65 },
				verbose: false,
			}),
		);
		expect(out).toContain("aislop");
		expect(out).toContain("Scan result");
		expect(out).toContain("my-app");
		expect(out).toMatch(/89 \/ 100\s+Healthy/);
		expect(out).toContain("Agent repair plan");
		expect(out).toMatch(/Agent\s+aislop agent\s+run a local worktree repair session/);
		expect(out).toMatch(
			/Provider\s+aislop agent --provider codex\s+or use --provider claude\/opencode/,
		);
		expect(out).toMatch(
			/Preview\s+aislop agent plan\s+preview provider, worktree, findings, and publish actions/,
		);
		expect(out).toMatch(/Auto-fix\s+aislop fix\s+auto-fix 1 issue/);
		expect(out).not.toContain("aislop fix --claude");
		expect(out).toContain("Gate every PR free at https://scanaislop.com");
	});

	it("renders clean-run one-liner when score is 100 and 0 issues", () => {
		const out = strip(
			buildScanRender({
				projectName: "my-app",
				language: "typescript",
				fileCount: 142,
				results: [engineResult({ engine: "format" })],
				diagnostics: [],
				score: { score: 100, label: "Excellent" },
				elapsedMs: 1400,
				thresholds: { good: 85, ok: 65 },
				verbose: false,
			}),
		);
		expect(out).toContain("Clean run");
		expect(out).not.toContain("Next steps");
		expect(out).not.toContain("→ Run aislop fix");
	});
});
