import { describe, expect, it } from "vitest";
import { buildBackgroundAgentArgs } from "../../src/commands/agent-background.js";
import { buildBackgroundMonitorArgs } from "../../src/commands/agent-monitor-background.js";
import type { AgentMonitorOptions } from "../../src/commands/agent-monitor-types.js";
import type { AgentOptions } from "../../src/commands/agent-types.js";

const baseOptions = (overrides: Partial<AgentOptions> = {}): AgentOptions => ({
	provider: "codex",
	providerSource: "cli",
	targetScore: 92,
	maxTurns: 5,
	limit: 4,
	inPlace: false,
	keepWorktree: true,
	apply: false,
	yes: false,
	dryRun: false,
	background: true,
	noFix: false,
	cleanup: false,
	commit: false,
	pr: false,
	commitMessage: "chore(aislop): repair AI slop findings",
	ready: false,
	...overrides,
});

const monitorOptions = (
	overrides: Partial<AgentMonitorOptions> = {},
): AgentMonitorOptions => ({
	...baseOptions({ background: true, inPlace: true }),
	interval: 5000,
	debounce: 1500,
	once: false,
	repair: true,
	...overrides,
});

describe("agent background launcher", () => {
	it("builds a foreground child command without recursive background flags", () => {
		const args = buildBackgroundAgentArgs(
			"/repo",
			baseOptions({
				apply: true,
				yes: true,
				pr: true,
				branch: "aislop/agent-test",
				base: "main",
				prTitle: "Repair AI slop",
				ready: true,
				keepWorktree: false,
			}),
		);

		expect(args).toContain("agent");
		expect(args).toContain("/repo");
		expect(args).toContain("--provider");
		expect(args).toContain("codex");
		expect(args).toContain("--apply");
		expect(args).toContain("--yes");
		expect(args).toContain("--pr");
		expect(args).toContain("--no-keep-worktree");
		expect(args).not.toContain("--background");
		expect(args).not.toContain("--dry-run");
	});

	it("builds a foreground monitor child command without recursive background flags", () => {
		const args = buildBackgroundMonitorArgs(
			"/repo",
			monitorOptions({
				interval: 1000,
				debounce: 250,
				noFix: true,
			}),
		);

		expect(args).toEqual([
			"agent",
			"monitor",
			"/repo",
			"--provider",
			"codex",
			"--target-score",
			"92",
			"--max-turns",
			"5",
			"--limit",
			"4",
			"--in-place",
			"--no-fix",
			"--repair",
			"--interval",
			"1000",
			"--debounce",
			"250",
		]);
		expect(args).not.toContain("--background");
		expect(args).not.toContain("--once");
	});
});
