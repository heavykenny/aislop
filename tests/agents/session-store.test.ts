import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type AgentSessionEvent,
	agentSessionDir,
	listAgentSessions,
	readAgentSessionEvents,
	resolveAgentSessionPath,
	summarizeAgentSession,
} from "../../src/agents/session-store.js";
import {
	renderAgentSessionList,
	renderAgentSessionShow,
} from "../../src/commands/agent-sessions.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

let tempDirs: string[] = [];

const writeSession = (
	root: string,
	id: string,
	events: Array<Partial<AgentSessionEvent> & { type: string }>,
	mtime: Date,
): string => {
	const dir = agentSessionDir(root);
	mkdirSync(dir, { recursive: true });
	const sessionPath = path.join(dir, `${id}.jsonl`);
	writeFileSync(
		sessionPath,
		events
			.map((event, index) =>
				JSON.stringify({
					timestamp: `2026-06-07T10:00:0${index}.000Z`,
					sessionId: id,
					...event,
				}),
			)
			.join("\n"),
		"utf-8",
	);
	utimesSync(sessionPath, mtime, mtime);
	return sessionPath;
};

describe("agent session store", () => {
	afterEach(() => {
		for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
		tempDirs = [];
	});

	it("summarizes, sorts, and resolves local JSONL sessions", () => {
		const root = mkdtempSync(path.join(tmpdir(), "aislop-agent-sessions-"));
		tempDirs.push(root);
		writeSession(
			root,
			"20260607-100000-1",
			[
				{
					type: "session.started",
					provider: "codex",
					providerLabel: "Codex",
					mode: "isolated_worktree",
				},
				{ type: "scan.baseline", score: 81, diagnostics: 5 },
				{ type: "provider.finished", pass: 1, exitCode: 0, toolCalls: 3, outputEvents: 7 },
				{
					type: "session.completed",
					scoreBefore: 81,
					scoreAfter: 94,
					changedFiles: 2,
					providerPasses: 1,
					toolCalls: 3,
					outputEvents: 7,
				},
			],
			new Date("2026-06-07T10:01:00.000Z"),
		);
		const latest = writeSession(
			root,
			"20260607-100100-2",
			[
				{ type: "session.started", provider: "claude", providerLabel: "Claude Code" },
				{ type: "session.failed", message: "provider exited" },
			],
			new Date("2026-06-07T10:02:00.000Z"),
		);

		const sessions = listAgentSessions(root);

		expect(sessions.map((session) => session.id)).toEqual([
			"20260607-100100-2",
			"20260607-100000-1",
		]);
		expect(sessions[1]).toMatchObject({
			status: "completed",
			providerLabel: "Codex",
			scoreBefore: 81,
			scoreAfter: 94,
			changedFiles: 2,
			providerPasses: 1,
			toolCalls: 3,
		});
		expect(resolveAgentSessionPath(root)).toBe(latest);
		expect(resolveAgentSessionPath(root, "20260607-100000")).toContain("20260607-100000-1");
	});

	it("renders compact list and show views", () => {
		const root = mkdtempSync(path.join(tmpdir(), "aislop-agent-sessions-"));
		tempDirs.push(root);
		const sessionPath = writeSession(
			root,
			"20260607-100000-1",
			[
				{
					type: "session.started",
					provider: "codex",
					providerLabel: "Codex",
					mode: "isolated_worktree",
				},
				{
					type: "worktree.prepared",
					path: path.join(root, ".aislop", "worktrees", "agent-1"),
					created: true,
				},
				{
					type: "findings.selected",
					pass: 1,
					count: 1,
					findings: [{ filePath: "src/a.ts", line: 7, rule: "ai-slop/example" }],
				},
				{ type: "provider.output", line: "edited src/a.ts" },
				{
					type: "provider.usage",
					usage: {
						totalTokens: 1680,
						inputTokens: 1200,
						cachedInputTokens: 400,
						outputTokens: 80,
						costUsd: 0.0123,
					},
				},
				{
					type: "file.changed",
					filePath: "src/a.ts",
					updatedAt: "2026-06-07T10:00:03.000Z",
					source: "git diff",
					additions: 12,
					deletions: 3,
				},
				{ type: "provider.output", line: "skipped likely false positive in src/b.ts" },
				{ type: "provider.finished", pass: 1, exitCode: 0, toolCalls: 4, outputEvents: 9 },
				{
					type: "diff.verified",
					pass: 1,
					scoreBefore: 82,
					changedFiles: ["src/a.ts"],
					scan: { score: 95, diagnostics: 0 },
				},
				{
					type: "session.completed",
					scoreBefore: 82,
					scoreAfter: 95,
					changedFiles: 1,
					providerPasses: 1,
					toolCalls: 4,
					outputEvents: 9,
				},
			],
			new Date("2026-06-07T10:01:00.000Z"),
		);
		const events = readAgentSessionEvents(sessionPath);
		const summary = summarizeAgentSession(sessionPath, events);

		const list = strip(renderAgentSessionList({ root, sessions: [summary] }));
		const show = strip(renderAgentSessionShow({ root, summary, events }));

		expect(list).toContain("Agent sessions");
		expect(list).toContain("20260607-100000-1");
		expect(list).toMatch(/Status\s+completed/);
		expect(list).toContain("82 -> 95");
		expect(list).toContain("1,680 tokens");
		expect(list).toContain("4 tool calls");
		expect(list).not.toMatch(/20260607-100000-1\s+completed/);

		const listLines = list.split("\n");
		const statusLine = listLines.find(
			(line) => line.includes("Status") && line.includes("completed"),
		);
		const scoreLine = listLines.find((line) => line.includes("Score") && line.includes("82 -> 95"));
		expect(statusLine?.indexOf("completed")).toBe(scoreLine?.indexOf("82 -> 95"));
		expect(show).toContain("Review summary");
		expect(show).toMatch(/Selected\s+1/);
		expect(show).toMatch(/Remaining\s+0/);
		expect(show).toContain("Usage");
		expect(show).toContain("$0.0123");
		expect(show).toMatch(/Passes\s+1/);
		expect(show).toContain("4 tool calls");
		expect(show).toMatch(/Transcript\s+\.aislop\/agent\/sessions\/20260607-100000-1\.jsonl/);
		expect(show).toMatch(/Worktree\s+\.aislop\/worktrees\/agent-1/);
		expect(show).not.toContain(sessionPath);
		expect(show).toContain("Provider notes");
		expect(show).toContain("skipped likely false positive");
		expect(show).toContain("Timeline");
		expect(show).toContain("pass 1 provider finished");
		expect(show).toContain("pass 1 diff verified");
		expect(show).toContain("Selected findings");
		expect(show).toContain("Changed files");
		expect(show).toContain("File activity");
		expect(show).toContain("src/a.ts · +12 -3");
		expect(show).not.toContain("src/a.ts · 2026-06-07T10:00:03.000Z");
		expect(show).toContain("Provider output");
		expect(show).toContain("edited src/a.ts");
	});

	it("summarizes queued background sessions before the child starts", () => {
		const root = mkdtempSync(path.join(tmpdir(), "aislop-agent-sessions-"));
		tempDirs.push(root);
		const sessionPath = writeSession(
			root,
			"20260607-queued-1",
			[
				{ type: "session.queued", mode: "background", providerSelection: "codex" },
				{ type: "background.started", pid: 1234, logPath: "/tmp/agent.log" },
			],
			new Date("2026-06-07T10:01:00.000Z"),
		);
		const events = readAgentSessionEvents(sessionPath);
		const summary = summarizeAgentSession(sessionPath, events);
		const show = strip(renderAgentSessionShow({ root, summary, events }));

		expect(summary).toMatchObject({
			status: "running",
			provider: "codex",
			mode: "background",
		});
		expect(show).toContain("queued background run with codex provider");
		expect(show).toContain("background process started pid 1234");
	});

	it("treats a later diff.applied event as an accepted session", () => {
		const root = mkdtempSync(path.join(tmpdir(), "aislop-agent-sessions-"));
		tempDirs.push(root);
		const sessionPath = writeSession(
			root,
			"20260607-applied-later-1",
			[
				{ type: "session.started", provider: "codex", providerLabel: "Codex" },
				{ type: "diff.verified", changedFiles: ["src/a.ts"], scan: { score: 96, diagnostics: 0 } },
				{ type: "diff.apply_skipped", applyRequested: false },
				{
					type: "session.completed",
					scoreBefore: 81,
					scoreAfter: 96,
					changedFiles: 1,
					applied: false,
				},
				{ type: "diff.applied", source: "agent apply", changedFiles: 1 },
			],
			new Date("2026-06-07T10:01:00.000Z"),
		);
		const events = readAgentSessionEvents(sessionPath);
		const summary = summarizeAgentSession(sessionPath, events);
		const show = strip(renderAgentSessionShow({ root, summary, events }));

		expect(summary.applied).toBe(true);
		expect(show).toMatch(/Apply\s+applied/);
		expect(show).toContain("diff applied to original worktree");
	});

	it("summarizes stopped background sessions as terminal", () => {
		const root = mkdtempSync(path.join(tmpdir(), "aislop-agent-sessions-"));
		tempDirs.push(root);
		const sessionPath = writeSession(
			root,
			"20260607-stopped-1",
			[
				{ type: "session.queued", mode: "background", providerSelection: "codex" },
				{ type: "background.started", pid: 1234, logPath: "/tmp/agent.log" },
				{ type: "background.stopped", pid: 1234, signal: "SIGTERM" },
			],
			new Date("2026-06-07T10:01:00.000Z"),
		);
		const events = readAgentSessionEvents(sessionPath);
		const summary = summarizeAgentSession(sessionPath, events);
		const show = strip(renderAgentSessionShow({ root, summary, events }));

		expect(summary).toMatchObject({
			status: "stopped",
			backgroundPid: 1234,
			logPath: "/tmp/agent.log",
		});
		expect(show).toContain("background process stopped with SIGTERM");
	});

	it("ignores a partial trailing JSONL line while a session is being written", () => {
		const root = mkdtempSync(path.join(tmpdir(), "aislop-agent-sessions-"));
		tempDirs.push(root);
		const sessionPath = writeSession(
			root,
			"20260607-partial-1",
			[{ type: "session.queued", mode: "background", providerSelection: "codex" }],
			new Date("2026-06-07T10:01:00.000Z"),
		);
		writeFileSync(sessionPath, `${readFileSync(sessionPath, "utf-8")}\n{"type":`, "utf-8");

		const events = readAgentSessionEvents(sessionPath);

		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("session.queued");
	});
});
