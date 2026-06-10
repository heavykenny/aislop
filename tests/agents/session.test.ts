import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildAgentSessionId,
	createAgentSessionRecorder,
} from "../../src/agents/session.js";

let tempDirs: string[] = [];

describe("agent sessions", () => {
	afterEach(() => {
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempDirs = [];
	});

	it("builds stable filesystem-safe session ids", () => {
		expect(buildAgentSessionId(new Date("2026-06-07T08:09:10.000Z"), 42)).toMatch(
			/^20260607-\d{6}-42$/,
		);
		expect(buildAgentSessionId(new Date("2026-06-07T08:09:10.000Z"), 42)).not.toContain(
			":",
		);
	});

	it("writes JSONL session events under the repo-local agent directory", () => {
		const root = mkdtempSync(path.join(tmpdir(), "aislop-agent-session-"));
		tempDirs.push(root);
		const recorder = createAgentSessionRecorder(root, {
			date: new Date("2026-06-07T08:09:10.000Z"),
			pid: 42,
		});

		recorder.append("session.started", { provider: "codex" });
		recorder.append("session.completed", { changedFiles: 2 });

		expect(recorder.id).toMatch(/^20260607-\d{6}-42$/);
		expect(recorder.path).toContain(path.join(".aislop", "agent", "sessions"));
		const events = readFileSync(recorder.path, "utf-8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { type: string; sessionId: string });
		expect(events.map((event) => event.type)).toEqual([
			"session.started",
			"session.completed",
		]);
		expect(events.every((event) => event.sessionId === recorder.id)).toBe(true);
	});

	it("accepts a preallocated session id for background runs", () => {
		const root = mkdtempSync(path.join(tmpdir(), "aislop-agent-session-"));
		tempDirs.push(root);
		const recorder = createAgentSessionRecorder(root, { id: "session-from-parent" });

		recorder.append("session.started");

		expect(recorder.id).toBe("session-from-parent");
		expect(path.basename(recorder.path)).toBe("session-from-parent.jsonl");
		const event = JSON.parse(readFileSync(recorder.path, "utf-8")) as { sessionId: string };
		expect(event.sessionId).toBe("session-from-parent");
	});
});
