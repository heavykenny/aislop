import { describe, expect, it, vi } from "vitest";
import { createSessionState } from "../../src/agents/session-state.js";

const base = {
	provider: "Codex",
	providerSource: "auto",
	targetScore: 90,
	targetRepo: "/repo",
};

describe("session state", () => {
	it("notifies subscribers on update", () => {
		const store = createSessionState(base);
		const fn = vi.fn();
		store.subscribe(fn);
		store.update({ score: 24 });
		expect(fn).toHaveBeenCalled();
		expect(store.getState().score).toBe(24);
	});

	it("dedupes changed files", () => {
		const store = createSessionState(base);
		store.recordEdit("a.ts");
		store.recordEdit("a.ts");
		store.recordEdit("b.ts");
		expect(store.getState().filesChanged.size).toBe(2);
	});

	it("caps the activity ring buffer", () => {
		const store = createSessionState(base);
		for (let i = 0; i < 300; i++) store.pushActivity({ kind: "tool", text: `t${i}`, at: i });
		expect(store.getState().activity.length).toBeLessThanOrEqual(200);
	});

	it("accumulates tokens", () => {
		const store = createSessionState(base);
		store.addTokens({ in: 10, total: 10 });
		store.addTokens({ in: 5, out: 3, total: 8 });
		expect(store.getState().tokens).toEqual({ in: 15, out: 3, cached: 0, total: 18 });
	});

	it("resolves askDecision when a renderer answers", async () => {
		const store = createSessionState(base);
		const pending = store.askDecision("Next?", [{ value: "stop", label: "Stop" }]);
		expect(store.getState().pendingDecision?.question).toBe("Next?");
		expect(store.getState().phase).toBe("awaiting-decision");
		store.getState().pendingDecision?.resolve("stop");
		expect(await pending).toBe("stop");
		expect(store.getState().pendingDecision).toBeNull();
	});
});
