import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { createSessionState } from "../../../src/agents/session-state.js";
import { Sidebar } from "../../../src/ui/agent-tui/Sidebar.js";

describe("Sidebar", () => {
	it("renders the score and hides cost/context when the model is unknown", () => {
		const store = createSessionState({
			provider: "Mystery",
			providerSource: "auto",
			targetScore: 90,
			targetRepo: "/r",
		});
		store.update({ score: 24, findingsRemaining: 51 });
		const { lastFrame } = render(<Sidebar state={store.getState()} />);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("24");
		expect(frame).toContain("Score");
		expect(frame).not.toContain("$");
	});

	it("shows cost when the provider model is known", () => {
		const store = createSessionState({
			provider: "Codex",
			providerSource: "auto",
			targetScore: 90,
			targetRepo: "/r",
		});
		store.addTokens({ in: 1000, out: 1000, total: 2000 });
		const { lastFrame } = render(<Sidebar state={store.getState()} />);
		expect(lastFrame() ?? "").toContain("$");
	});
});
