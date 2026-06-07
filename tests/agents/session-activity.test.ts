import { describe, expect, it } from "vitest";
import {
	createUsageTotals,
	formatUsageTotals,
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
		expect(formatUsageTotals(usage)).toContain("1,820 total");
		expect(formatUsageTotals(usage)).toContain("$0.0123");
	});
});
