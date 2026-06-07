import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "../../src/agents/session-store.js";
import { renderAgentWatchEvent, renderAgentWatchSnapshot } from "../../src/commands/agent-watch.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

const event = (type: string, extra: Record<string, unknown> = {}): AgentSessionEvent => ({
	type,
	timestamp: "2026-06-07T10:00:00.000Z",
	sessionId: "session-1",
	...extra,
});

describe("agent watch", () => {
	it("renders provider output as compact stream lines", () => {
		const out = strip(
			renderAgentWatchEvent(
				event("provider.output", {
					provider: "codex",
					line: JSON.stringify({ type: "assistant", message: "raw transport" }),
					displayLine: "assistant: editing src/a.ts",
				}),
			) ?? "",
		);

		expect(out).toContain("codex");
		expect(out).toContain("editing src/a.ts");
		expect(out).not.toContain("raw transport");
	});

	it("renders a session snapshot with timeline events", () => {
		const out = strip(
			renderAgentWatchSnapshot({
				root: "/repo",
				sessionPath: "/repo/.aislop/agent/sessions/session-1.jsonl",
				events: [
					event("session.queued", { mode: "background", providerSelection: "codex" }),
					event("background.started", { pid: 123 }),
					event("background.stopped", { signal: "SIGTERM" }),
				],
			}),
		);

		expect(out).toContain("Agent watch");
		expect(out).toContain("session-1");
		expect(out).toContain("queued background run with codex provider");
		expect(out).toContain("background process started pid 123");
		expect(out).toContain("background process stopped with SIGTERM");
		expect(out).toContain("Review summary");
		expect(out).toMatch(/Provider\s+not started/);
		expect(out).toMatch(/Transcript\s+\.aislop\/agent\/sessions\/session-1\.jsonl/);
		expect(out).not.toContain("/repo/.aislop/agent/sessions/session-1.jsonl");
	});

	it("renders terminal session review details from scan and provider events", () => {
		const out = strip(
			renderAgentWatchSnapshot({
				root: "/repo",
				sessionPath: "/repo/.aislop/agent/sessions/session-2.jsonl",
				events: [
					event("session.started", { provider: "codex", providerLabel: "Codex" }),
					event("scan.baseline", { score: 71, diagnostics: 4 }),
					event("findings.selected", { pass: 1, count: 2 }),
					event("provider.finished", { pass: 1, exitCode: 0, toolCalls: 5 }),
					event("provider.output", { line: "intentional skip for false positive" }),
					event("diff.verified", {
						pass: 1,
						scoreBefore: 71,
						changedFiles: ["src/a.ts"],
						scan: { score: 94, diagnostics: 1 },
					}),
					event("session.completed", {
						scoreBefore: 71,
						scoreAfter: 94,
						changedFiles: 1,
						providerPasses: 1,
						toolCalls: 5,
					}),
				],
			}),
		);

		expect(out).toContain("Review summary");
		expect(out).toMatch(/Score\s+71 -> 94/);
		expect(out).toMatch(/Transcript\s+\.aislop\/agent\/sessions\/session-2\.jsonl/);
		expect(out).toMatch(/Selected\s+2/);
		expect(out).toMatch(/Remaining\s+1/);
		expect(out).toContain("5 tool calls");
		expect(out).toContain("pass 1 provider finished");
		expect(out).toContain("Provider notes");
		expect(out).toContain("intentional skip for false positive");
	});
});
