import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "../../src/agents/session-store.js";
import { backgroundPidFromEvents } from "../../src/commands/agent-stop.js";

const event = (type: string, extra: Record<string, unknown> = {}): AgentSessionEvent => ({
	type,
	timestamp: "2026-06-07T10:00:00.000Z",
	sessionId: "session-1",
	...extra,
});

describe("agent stop", () => {
	it("uses the latest background pid from a session transcript", () => {
		expect(
			backgroundPidFromEvents([
				event("session.queued"),
				event("background.started", { pid: 111 }),
				event("background.started", { pid: 222 }),
			]),
		).toBe(222);
	});

	it("returns null when no background process was recorded", () => {
		expect(backgroundPidFromEvents([event("session.started")])).toBeNull();
	});
});
