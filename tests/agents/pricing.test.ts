import { describe, expect, it } from "vitest";
import { computeCostUsd, contextPct, resolvePricing } from "../../src/agents/pricing.js";

describe("pricing", () => {
	it("resolves a known model by id", () => {
		const p = resolvePricing("codex", "gpt-5.4");
		expect(p?.contextWindow).toBeGreaterThan(0);
	});
	it("falls back to a provider default model", () => {
		expect(resolvePricing("claude", null)).not.toBeNull();
	});
	it("returns null for an unknown provider/model", () => {
		expect(resolvePricing("mystery", "who-knows")).toBeNull();
	});
	it("computes cost from tokens", () => {
		const p = resolvePricing("codex", "gpt-5.4");
		if (!p) throw new Error("expected pricing");
		const cost = computeCostUsd(p, { in: 1_000_000, out: 1_000_000, cached: 0, total: 2_000_000 });
		expect(cost).toBeCloseTo(p.inPerMTok + p.outPerMTok, 5);
	});
	it("computes context percent", () => {
		const p = resolvePricing("codex", "gpt-5.4");
		if (!p) throw new Error("expected pricing");
		const pct = contextPct(p, { in: 0, out: 0, cached: 0, total: p.contextWindow / 2 });
		expect(pct).toBeCloseTo(50, 1);
	});
	it("hides cost/ctx when pricing is null", () => {
		expect(computeCostUsd(null, { in: 1, out: 1, cached: 0, total: 2 })).toBeNull();
		expect(contextPct(null, { in: 0, out: 0, cached: 0, total: 1 })).toBeNull();
	});
});
