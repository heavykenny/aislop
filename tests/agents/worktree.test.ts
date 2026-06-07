import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentWorktree, removeAgentWorktree } from "../../src/agents/worktree.js";

let tempDirs: string[] = [];

const git = (cwd: string, args: string[]): void => {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
	}
};

const createRepo = (): string => {
	const root = mkdtempSync(path.join(tmpdir(), "aislop-agent-worktree-"));
	tempDirs.push(root);
	git(root, ["init"]);
	git(root, ["config", "user.email", "test@example.com"]);
	git(root, ["config", "user.name", "Test User"]);
	writeFileSync(path.join(root, "index.ts"), "export const value = 1;\n", "utf-8");
	git(root, ["add", "index.ts"]);
	git(root, ["commit", "-m", "init"]);
	return root;
};

describe("agent worktrees", () => {
	afterEach(() => {
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempDirs = [];
	});

	it("keeps local agent state out of git status without hiding all aislop config", async () => {
		const root = createRepo();
		const sessionDir = path.join(root, ".aislop", "agent", "sessions");
		mkdirSync(sessionDir, { recursive: true });
		writeFileSync(path.join(sessionDir, "session.jsonl"), "{}\n", "utf-8");

		const created = await createAgentWorktree(root, { inPlace: false });
		await removeAgentWorktree(created.worktree);

		const exclude = readFileSync(path.join(root, ".git", "info", "exclude"), "utf-8");
		expect(exclude).toContain(".aislop/worktrees/");
		expect(exclude).toContain(".aislop/agent/sessions/");
		expect(exclude).toContain(".aislop/agent/logs/");
		expect(exclude).toContain(".aislop/agent/monitors/");
		expect(exclude).toContain(".aislop/agent/provider.json");
		expect(exclude).not.toMatch(/^\.aislop\/$/m);
	});
});
