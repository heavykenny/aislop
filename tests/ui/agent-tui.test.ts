import { describe, expect, it } from "vitest";
import { AgentTui } from "../../src/ui/agent-tui.js";

const mkTui = () => {
	const chunks: string[] = [];
	const tui = new AgentTui({
		write: (chunk) => chunks.push(chunk),
		tty: false,
		provider: "Codex",
		source: "auto-detect installed provider",
		directory: "/repo",
		mode: "isolated git worktree",
		targetScore: 90,
	});
	return { tui, out: () => chunks.join("") };
};

describe("AgentTui adapter (non-TTY)", () => {
	it("streams step completions, provider output, and the footer", async () => {
		const { tui, out } = mkTui();
		tui.start("Preparing local session");
		tui.complete({ status: "done", label: "Created worktree agent-2680" });
		tui.appendLog("codex", "assistant: fixed issue");
		tui.setFiles([{ filePath: "src/a.ts", updatedAt: "now", additions: 12, deletions: 3 }]);
		await tui.finish({ footer: "Done · codex · 800ms" });

		const text = out();
		expect(text).toContain("Created worktree agent-2680");
		expect(text).toContain("codex");
		expect(text).toContain("assistant: fixed issue");
		expect(text).toContain("Done · codex · 800ms");
		// No alt-screen takeover in the plain path.
		expect(text).not.toContain("\x1b[?1049h");
	});

	it("does not throw on the full reporter API", async () => {
		const { tui } = mkTui();
		tui.start("step");
		tui.setActiveLabel("step working");
		tui.setMetric("Score", "14 -> 24");
		tui.setMetric("Remaining", 51);
		tui.setMetric("Pass", 1);
		tui.setUsage({ inputTokens: 1000, totalTokens: 2000, costUsd: 0.05 });
		tui.setActions(["Continue: 3 actionable findings remain"]);
		tui.complete({ status: "done", label: "step done" });
		await expect(tui.abort()).resolves.toBeUndefined();
	});
});
