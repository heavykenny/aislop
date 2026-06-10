import { describe, expect, it } from "vitest";
import {
	createSessionStats,
	createUsageTotals,
	formatDiffStat,
	formatToolCalls,
	formatUsageTotals,
	isProviderToolLine,
	mergeProviderUsage,
} from "../../src/agents/session-activity.js";

describe("agent session activity", () => {
	it("merges provider usage as latest known totals", () => {
		const usage = createUsageTotals();
		Object.assign(
			usage,
			mergeProviderUsage(usage, {
				inputTokens: 1000,
				cachedInputTokens: 500,
				outputTokens: 80,
				totalTokens: 1580,
			}),
		);
		Object.assign(
			usage,
			mergeProviderUsage(usage, {
				inputTokens: 1200,
				outputTokens: 120,
				totalTokens: 1820,
				costUsd: 0.0123,
			}),
		);

		expect(usage).toMatchObject({
			inputTokens: 1200,
			cachedInputTokens: 500,
			outputTokens: 120,
			totalTokens: 1820,
			costUsd: 0.0123,
		});
		expect(formatUsageTotals(usage)).toContain("2k total");
		expect(formatUsageTotals(usage)).toContain("$0.01");
	});

	it("tracks provider pass and tool-call counters", () => {
		const stats = createSessionStats();
		stats.providerPasses = 2;
		stats.toolCalls = 14;
		stats.outputEvents = 30;

		expect(formatToolCalls(stats.toolCalls)).toBe("14 tool calls");
		expect(isProviderToolLine("exec: pnpm test")).toBe(true);
		expect(isProviderToolLine("tool: Edit")).toBe(true);
		expect(isProviderToolLine("assistant: done")).toBe(false);
	});

	it("formats edited file diff stats", () => {
		expect(formatDiffStat({ additions: 12, deletions: 3 })).toBe("+12 -3");
		expect(formatDiffStat({ additions: null, deletions: null, binary: true })).toBe("binary");
		expect(formatDiffStat({})).toBe("changed");
	});
});
