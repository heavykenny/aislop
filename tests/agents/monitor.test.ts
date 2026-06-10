import { describe, expect, it } from "vitest";
import { parseGitStatusPaths, shouldMonitorRepair } from "../../src/commands/agent-monitor.js";

describe("agent monitor", () => {
	it("parses porcelain git status paths for changed and renamed files", () => {
		expect(
			parseGitStatusPaths(["M README.md", " M src/a.ts", "?? src/new.ts", "R  old.ts -> src/renamed.ts"].join("\n")),
		).toEqual(["README.md", "src/a.ts", "src/new.ts", "src/renamed.ts"]);
	});

	it("only repairs when explicitly enabled for the current worktree and below target", () => {
		expect(
			shouldMonitorRepair({
				repair: true,
				inPlace: true,
				score: 72,
				targetScore: 90,
				findings: 2,
			}),
		).toBe(true);
		expect(
			shouldMonitorRepair({
				repair: false,
				inPlace: true,
				score: 72,
				targetScore: 90,
				findings: 2,
			}),
		).toBe(false);
		expect(
			shouldMonitorRepair({
				repair: true,
				inPlace: false,
				score: 72,
				targetScore: 90,
				findings: 2,
			}),
		).toBe(false);
		expect(
			shouldMonitorRepair({
				repair: true,
				inPlace: true,
				score: 96,
				targetScore: 90,
				findings: 2,
			}),
		).toBe(false);
	});
});
