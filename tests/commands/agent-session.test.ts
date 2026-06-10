import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgentSessionCwd } from "../../src/commands/agent-session.js";

const worktreeState = (root: string, worktreePath: string) => ({
	state: {
		root,
		gitCommonDir: path.join(root, ".git"),
		branch: "main",
		head: "abc123",
		dirty: false,
	},
	worktree: {
		originalRoot: root,
		path: worktreePath,
		name: "agent-test",
		created: true,
	},
});

describe("agent session path scoping", () => {
	it("maps a requested subdirectory into the isolated worktree", () => {
		const root = path.resolve("/repo");
		const worktreePath = path.resolve("/repo/.aislop/worktrees/agent-test");

		expect(
			resolveAgentSessionCwd(worktreeState(root, worktreePath), path.join(root, "packages/foo")),
		).toBe(path.join(worktreePath, "packages/foo"));
	});

	it("uses the worktree root when the requested directory is the repo root", () => {
		const root = path.resolve("/repo");
		const worktreePath = path.resolve("/repo/.aislop/worktrees/agent-test");

		expect(resolveAgentSessionCwd(worktreeState(root, worktreePath), root)).toBe(worktreePath);
	});
});
