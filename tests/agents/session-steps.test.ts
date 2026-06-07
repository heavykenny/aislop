import { afterEach, describe, expect, it, vi } from "vitest";
import { maybeApplyDiff } from "../../src/commands/agent-session-steps.js";
import type { AgentOptions } from "../../src/commands/agent-types.js";
import type { AgentTui } from "../../src/ui/agent-tui.js";

const promptMock = vi.hoisted(() => ({
	select: vi.fn(),
}));

vi.mock("../../src/ui/prompts.js", () => ({
	isCancel: () => false,
	select: promptMock.select,
}));

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

describe("agent session steps", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		promptMock.select.mockReset();
	});

	it("offers apply before keeping the worktree for review", async () => {
		const originalIsTty = process.stdin.isTTY;
		const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
		promptMock.select.mockResolvedValue("review");

		try {
			await maybeApplyDiff({
				options,
				changedFiles: ["src/a.ts"],
				worktreePath: "/repo/flashwave/.aislop/worktrees/agent-1",
				originalRoot: "/repo/flashwave",
				tui: {
					pause: vi.fn(),
					resume: vi.fn(),
				} as unknown as AgentTui,
				session: {
					id: "session-1",
					path: "/repo/flashwave/.aislop/agent/sessions/session-1.jsonl",
					append: vi.fn(),
				},
				usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
				stats: { providerPasses: 1, toolCalls: 1, outputEvents: 1 },
				files: [
					{
						filePath: "src/a.ts",
						updatedAt: "2026-06-07T22:38:02.000Z",
						source: "git diff",
						additions: 1,
						deletions: 1,
					},
				],
			});
		} finally {
			Object.defineProperty(process.stdin, "isTTY", {
				configurable: true,
				value: originalIsTty,
			});
			stdoutWrite.mockRestore();
		}

		const prompt = promptMock.select.mock.calls[0]?.[0];
		expect(prompt).toMatchObject({
			initialValue: "apply",
			options: [
				{ value: "apply", label: "Apply changes to flashwave" },
				{ value: "review", label: "Keep worktree for review" },
			],
		});
	});
});
