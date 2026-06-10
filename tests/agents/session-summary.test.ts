import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../src/agents/providers.js";
import { printAgentSessionSummary } from "../../src/commands/agent-session-summary.js";
import type { AgentOptions, AgentScanJson } from "../../src/commands/agent-types.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

const options: AgentOptions = {
	provider: "auto",
	providerSource: "auto",
	targetScore: 90,
	maxTurns: 12,
	limit: 8,
	inPlace: false,
	keepWorktree: true,
	apply: false,
	yes: false,
	dryRun: false,
	background: false,
	noFix: false,
	cleanup: false,
	commit: false,
	pr: false,
	commitMessage: "chore: apply aislop agent fixes",
	ready: false,
};

const scan = (score: number, diagnostics = 0): AgentScanJson => ({
	score,
	label: "healthy",
	diagnostics: [],
	summary: { errors: 0, warnings: diagnostics, fixable: 0, files: 1 },
});

const captureStdout = (run: () => void): string => {
	const chunks: string[] = [];
	const originalWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = (chunk: unknown) => {
		chunks.push(String(chunk));
		return true;
	};
	try {
		run();
	} finally {
		process.stdout.write = originalWrite;
	}
	return strip(chunks.join(""));
};

describe("agent session summary", () => {
	it("shows repo-relative transcript and worktree paths", () => {
		const root = "/repo/flashwave";
		const transcript = path.join(
			root,
			".aislop",
			"agent",
			"sessions",
			"20260607-223802-2680.jsonl",
		);
		const worktree = path.join(root, ".aislop", "worktrees", "agent-20260607-223802-2680");

		const out = captureStdout(() => {
			printAgentSessionSummary({
				before: scan(14),
				after: scan(36, 8),
				changedFiles: ["app/index.tsx"],
				applied: false,
				published: null,
				provider: {
					provider: PROVIDERS[0],
					installed: true,
					authenticated: true,
					version: "codex-cli 0.134.0",
					authHint: null,
				},
				options,
				session: { id: "20260607-223802-2680", path: transcript, append: () => {} },
				worktreePath: worktree,
				originalRoot: root,
				usage: {
					inputTokens: 1200,
					cachedInputTokens: 400,
					outputTokens: 300,
					totalTokens: 1900,
				},
				stats: { providerPasses: 2, toolCalls: 7, outputEvents: 18 },
				fileActivity: [
					{
						filePath: "app/index.tsx",
						updatedAt: "2026-06-07T22:38:02.000Z",
						source: "git diff",
						additions: 3,
						deletions: 1,
					},
				],
			});
		});

		expect(out).toMatch(/Transcript\s+\.aislop\/agent\/sessions\/20260607-223802-2680\.jsonl/);
		expect(out).toMatch(/Worktree\s+\.aislop\/worktrees\/agent-20260607-223802-2680/);
		expect(out).toMatch(/Review\s+\.aislop\/worktrees\/agent-20260607-223802-2680/);
		expect(out).not.toContain(transcript);
		expect(out).not.toContain(worktree);
	});
});
