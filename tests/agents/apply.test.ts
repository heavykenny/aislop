import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "../../src/agents/session-store.js";
import {
	renderAgentApplyPreview,
	resolveAgentApplyTarget,
} from "../../src/commands/agent-apply.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

const event = (type: string, extra: Record<string, unknown> = {}): AgentSessionEvent => ({
	type,
	timestamp: "2026-06-07T10:00:00.000Z",
	sessionId: "session-1",
	...extra,
});

describe("agent apply", () => {
	it("resolves an isolated worktree session into an apply target", () => {
		const target = resolveAgentApplyTarget({
			root: "/repo",
			sessionPath: "/repo/.aislop/agent/sessions/session-1.jsonl",
			events: [
				event("session.started", { root: "/repo" }),
				event("worktree.prepared", { path: "/repo/.aislop/worktrees/agent-1", created: true }),
				event("diff.verified", { changedFiles: ["src/a.ts"] }),
				event("diff.apply_skipped", { applyRequested: false }),
				event("session.completed", { applied: false, changedFiles: 1 }),
			],
		});

		expect(target).toMatchObject({
			sessionId: "session-1",
			targetRoot: "/repo",
			worktreePath: "/repo/.aislop/worktrees/agent-1",
			alreadyApplied: false,
			worktreeRemoved: false,
		});
	});

	it("refuses in-place sessions because there is no later diff to accept", () => {
		expect(() =>
			resolveAgentApplyTarget({
				root: "/repo",
				sessionPath: "/repo/.aislop/agent/sessions/session-1.jsonl",
				events: [
					event("session.started", { root: "/repo" }),
					event("worktree.prepared", { path: "/repo", created: false }),
				],
			}),
		).toThrow("already ran in the current worktree");
	});

	it("marks already-applied and removed worktrees before touching git", () => {
		const target = resolveAgentApplyTarget({
			root: "/repo",
			sessionPath: "/repo/.aislop/agent/sessions/session-1.jsonl",
			events: [
				event("session.started", { root: "/repo" }),
				event("worktree.prepared", { path: "/repo/.aislop/worktrees/agent-1", created: true }),
				event("diff.applied", { changedFiles: 1 }),
				event("worktree.removed", { path: "/repo/.aislop/worktrees/agent-1" }),
			],
		});

		expect(target.alreadyApplied).toBe(true);
		expect(target.worktreeRemoved).toBe(true);
	});

	it("renders a dry-run preview with target, worktree, and changed files", () => {
		const out = strip(
			renderAgentApplyPreview({
				target: {
					sessionId: "session-1",
					sessionPath: "/repo/.aislop/agent/sessions/session-1.jsonl",
					targetRoot: "/repo",
					worktreePath: "/repo/.aislop/worktrees/agent-1",
					alreadyApplied: false,
					worktreeRemoved: false,
				},
				changedFiles: ["src/a.ts", "src/b.ts"],
				patchBytes: 2048,
				dryRun: true,
			}),
		);

		expect(out).toContain("Agent apply");
		expect(out).toContain("Patch");
		expect(out).toMatch(/Session\s+\.aislop\/agent\/sessions\/session-1\.jsonl/);
		expect(out).toMatch(/Worktree\s+\/repo\/\.aislop\/worktrees\/agent-1/);
		expect(out).toMatch(/Bytes\s+2048/);
		expect(out).toMatch(/Changed\s+2/);
		expect(out).toContain("src/a.ts");
		expect(out).toMatch(/Apply\s+rerun without --dry-run/);
		expect(out).not.toContain("Session:");

		const lines = out.split("\n");
		const targetLine = lines.find((line) => line.includes("Target"));
		const worktreeLine = lines.find((line) => line.includes("Worktree"));
		expect(targetLine?.indexOf("/repo")).toBe(
			worktreeLine?.indexOf("/repo/.aislop/worktrees/agent-1"),
		);
	});
});
