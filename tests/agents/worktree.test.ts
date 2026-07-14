import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createAgentWorktree,
	diffNameOnly,
	diffNumstat,
	readAgentRoot,
	readBinaryDiff,
	removeAgentWorktree,
} from "../../src/agents/worktree.js";

let tempDirs: string[] = [];

const git = (cwd: string, args: string[]): void => {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
	}
};

const gitWithInput = (cwd: string, args: string[], input: string): void => {
	const result = spawnSync("git", args, { cwd, input, encoding: "utf-8" });
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
	// Pin LF so a developer's global core.autocrlf=true (common on Windows) can't rewrite
	// fixture line endings out from under byte-exact patch assertions.
	git(root, ["config", "core.autocrlf", "false"]);
	git(root, ["config", "core.eol", "lf"]);
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

	it("can read the repo root without mutating local git excludes", async () => {
		const root = createRepo();
		const excludePath = path.join(root, ".git", "info", "exclude");
		const before = existsSync(excludePath) ? readFileSync(excludePath, "utf-8") : "";

		// .native() to match readAgentRoot's canonicalization: it expands 8.3 short names, so a
		// short-form TEMP (e.g. CI's C:\Users\RUNNER~1\...) resolves to the same long path.
		await expect(readAgentRoot(root)).resolves.toEqual({ root: realpathSync.native(root) });

		const after = existsSync(excludePath) ? readFileSync(excludePath, "utf-8") : "";
		expect(after).toBe(before);
	});

	it("reads per-file added and deleted line counts", async () => {
		const root = createRepo();
		writeFileSync(
			path.join(root, "index.ts"),
			"export const value = 2;\nexport const next = 3;\n",
			"utf-8",
		);

		const stats = await diffNumstat(root);

		expect(stats.get("index.ts")).toMatchObject({
			additions: 2,
			deletions: 1,
			binary: false,
		});
	});

	it("lists staged and untracked files as agent worktree changes", async () => {
		const root = createRepo();
		writeFileSync(path.join(root, "index.ts"), "export const value = 2;\n", "utf-8");
		git(root, ["add", "index.ts"]);
		writeFileSync(path.join(root, "new.ts"), "export const added = true;\n", "utf-8");

		await expect(diffNameOnly(root)).resolves.toEqual(["index.ts", "new.ts"]);
	});

	it("reads staged and untracked files into an applyable patch", async () => {
		const root = createRepo();
		writeFileSync(path.join(root, "index.ts"), "export const value = 2;\n", "utf-8");
		git(root, ["add", "index.ts"]);
		writeFileSync(path.join(root, "new.ts"), "export const added = true;\n", "utf-8");
		const target = mkdtempSync(path.join(tmpdir(), "aislop-agent-worktree-target-"));
		tempDirs.push(target);
		git(root, ["clone", "-c", "core.autocrlf=false", "-c", "core.eol=lf", root, target]);

		const patch = await readBinaryDiff(root);
		gitWithInput(target, ["apply"], patch);

		expect(readFileSync(path.join(target, "index.ts"), "utf-8")).toBe("export const value = 2;\n");
		expect(readFileSync(path.join(target, "new.ts"), "utf-8")).toBe("export const added = true;\n");
	});
});
