import { describe, expect, it } from "vitest";
import {
	parseGitStatusPaths,
	shouldMonitorRepair,
	updateMonitorDebounceState,
	type GitChangeSnapshot,
} from "../../src/commands/agent-monitor.js";

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

	it("does not restart debounce for the same pending snapshot", () => {
		const current: GitChangeSnapshot = { signature: "", files: [] };
		const changed: GitChangeSnapshot = { signature: " M src/a.ts\n", files: ["src/a.ts"] };
		const first = updateMonitorDebounceState({
			current,
			pending: null,
			changedAt: 0,
			next: changed,
			now: 100,
			debounce: 1_000,
		});
		expect(first.detected).toBe(true);
		expect(first.pending).toBe(changed);
		expect(first.changedAt).toBe(100);

		const stillPending = updateMonitorDebounceState({
			current: first.current,
			pending: first.pending,
			changedAt: first.changedAt,
			next: changed,
			now: 800,
			debounce: 1_000,
		});
		expect(stillPending.detected).toBe(false);
		expect(stillPending.pending).toBe(changed);
		expect(stillPending.changedAt).toBe(100);
		expect(stillPending.settled).toBeNull();

		const settled = updateMonitorDebounceState({
			current: stillPending.current,
			pending: stillPending.pending,
			changedAt: stillPending.changedAt,
			next: changed,
			now: 1_101,
			debounce: 1_000,
		});
		expect(settled.current).toBe(changed);
		expect(settled.pending).toBeNull();
		expect(settled.settled).toBe(changed);
	});

	it("settles the first changed snapshot immediately when debounce is zero", () => {
		const current: GitChangeSnapshot = { signature: "", files: [] };
		const changed: GitChangeSnapshot = { signature: " M src/a.ts\n", files: ["src/a.ts"] };
		const settled = updateMonitorDebounceState({
			current,
			pending: null,
			changedAt: 0,
			next: changed,
			now: 100,
			debounce: 0,
		});
		expect(settled.current).toBe(changed);
		expect(settled.pending).toBeNull();
		expect(settled.changedAt).toBe(0);
		expect(settled.detected).toBe(true);
		expect(settled.settled).toBe(changed);
	});

	it("clears pending debounce when changes return to the current snapshot", () => {
		const current: GitChangeSnapshot = { signature: "", files: [] };
		const changed: GitChangeSnapshot = { signature: " M src/a.ts\n", files: ["src/a.ts"] };
		const first = updateMonitorDebounceState({
			current,
			pending: null,
			changedAt: 0,
			next: changed,
			now: 100,
			debounce: 1_000,
		});
		const reverted = updateMonitorDebounceState({
			current: first.current,
			pending: first.pending,
			changedAt: first.changedAt,
			next: current,
			now: 500,
			debounce: 1_000,
		});
		expect(reverted.current).toBe(current);
		expect(reverted.pending).toBeNull();
		expect(reverted.changedAt).toBe(0);
		expect(reverted.settled).toBeNull();
	});
});
