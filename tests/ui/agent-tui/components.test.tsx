import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { createSessionState } from "../../../src/agents/session-state.js";
import { ActivityPane } from "../../../src/ui/agent-tui/ActivityPane.js";
import { AgentApp } from "../../../src/ui/agent-tui/AgentApp.js";
import { DecisionBar } from "../../../src/ui/agent-tui/DecisionBar.js";
import { FooterBar } from "../../../src/ui/agent-tui/FooterBar.js";

const storeFor = () =>
	createSessionState({
		provider: "Codex",
		providerSource: "auto",
		targetScore: 90,
		targetRepo: "/repo",
		branch: "main",
	});

describe("ActivityPane", () => {
	it("tails the last N lines", () => {
		const activity = [
			{ kind: "tool" as const, text: "first", at: 1 },
			{ kind: "exec" as const, text: "second", at: 2 },
			{ kind: "assistant" as const, text: "third", at: 3 },
		];
		const { lastFrame } = render(<ActivityPane activity={activity} rows={2} />);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("third");
		expect(frame).toContain("second");
		expect(frame).not.toContain("first");
	});
});

describe("DecisionBar", () => {
	it("renders the question and options", () => {
		const decision = {
			question: "Next step for pass 2",
			options: [
				{ value: "stop", label: "Stop and review" },
				{ value: "continue", label: "Continue another pass" },
			],
			resolve: () => {},
		};
		const { lastFrame } = render(<DecisionBar decision={decision} />);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("Next step for pass 2");
		expect(frame).toContain("Stop and review");
	});
});

describe("FooterBar", () => {
	it("shows repo, branch, and quit hint", () => {
		const { lastFrame } = render(<FooterBar repo="/repo" branch="main" worktree={null} />);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("/repo");
		expect(frame).toContain("main");
		expect(frame).toContain("ctrl+c");
	});
});

describe("AgentApp", () => {
	it("composes the sidebar, activity, and footer", () => {
		const store = storeFor();
		store.update({ score: 24, findingsRemaining: 51 });
		store.pushActivity({ kind: "tool", text: "edit useStrobeLogic.ts", at: 1 });
		const { lastFrame } = render(<AgentApp store={store} />);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("Score");
		expect(frame).toContain("edit useStrobeLogic.ts");
		expect(frame).toContain("ctrl+c");
	});

	it("renders the decision bar when a decision is pending", () => {
		const store = storeFor();
		void store.askDecision("Stop or continue?", [{ value: "stop", label: "Stop" }]);
		const { lastFrame } = render(<AgentApp store={store} />);
		expect(lastFrame() ?? "").toContain("Stop or continue?");
	});

	it("unsubscribes from store updates on unmount", () => {
		const store = storeFor();
		const unsubscribe = vi.fn();
		const subscribe = vi.spyOn(store, "subscribe").mockReturnValue(unsubscribe);

		const { unmount } = render(<AgentApp store={store} />);
		expect(subscribe).toHaveBeenCalledTimes(1);

		unmount();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});
});
