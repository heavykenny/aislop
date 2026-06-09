import { describe, expect, it } from "vitest";
import { buildRepairPrompt, selectAgentFindings } from "../../src/agents/prompt.js";
import type { Diagnostic } from "../../src/engines/types.js";

const diag = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
	filePath: "src/index.ts",
	engine: "ai-slop",
	rule: "ai-slop/narrative-comment",
	severity: "warning",
	message: "Narrative comment explains obvious code",
	line: 1,
	column: 1,
	category: "AI slop",
	fixable: false,
	...overrides,
});

describe("agent repair prompt", () => {
	it("prioritizes errors and non-fixable findings for the provider", () => {
		const selected = selectAgentFindings(
			[
				diag({ rule: "info/ignored", severity: "info" }),
				diag({ rule: "ai-slop/fixable", severity: "warning", fixable: true }),
				diag({ rule: "security/hardcoded-secret", severity: "error" }),
				diag({ rule: "complexity/function-too-long", severity: "warning", fixable: false }),
			],
			3,
		);

		expect(selected.map((finding) => finding.rule)).toEqual([
			"security/hardcoded-secret",
			"complexity/function-too-long",
			"ai-slop/fixable",
		]);
	});

	it("builds a constrained local repair prompt", () => {
		const prompt = buildRepairPrompt({
			rootDirectory: process.cwd(),
			findings: [diag()],
			score: 82,
			targetScore: 90,
			maxTurns: 4,
		});

		expect(prompt).toContain("local git worktree");
		expect(prompt).toContain("Current aislop score: 82/100");
		expect(prompt).toContain("Target score: 90/100");
		expect(prompt).toContain("Do not delete tests");
		expect(prompt).toContain("If a finding looks like a false positive");
		expect(prompt).toContain("ai-slop/narrative-comment");
	});
});
