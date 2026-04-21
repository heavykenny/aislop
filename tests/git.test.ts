import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getChangedFiles, getStagedFiles } from "../src/utils/git.js";

const git = (cwd: string, args: string[]) => {
	execFileSync("git", args, { cwd, stdio: "ignore" });
};

const write = (root: string, rel: string, body = "") => {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, body, "utf-8");
};

describe("getChangedFiles", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-git-"));
		git(tmpDir, ["init"]);
		git(tmpDir, ["config", "user.email", "test@example.com"]);
		git(tmpDir, ["config", "user.name", "test"]);
		git(tmpDir, ["config", "commit.gpgsign", "false"]);
		write(tmpDir, "base.ts", "export const base = 1;\n");
		git(tmpDir, ["add", "base.ts"]);
		git(tmpDir, ["commit", "-m", "init", "--no-verify"]);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("includes staged new files", () => {
		write(tmpDir, "added.ts", "export const added = 1;\n");
		git(tmpDir, ["add", "added.ts"]);

		const files = getChangedFiles(tmpDir);
		expect(files).toContain(path.join(tmpDir, "added.ts"));
	});

	it("includes modified tracked files", () => {
		write(tmpDir, "base.ts", "export const base = 2;\n");

		const files = getChangedFiles(tmpDir);
		expect(files).toContain(path.join(tmpDir, "base.ts"));
	});

	it("includes untracked files that have not yet been staged", () => {
		// Regression: `git diff HEAD --diff-filter=ACMR` alone misses untracked
		// files, so `aislop scan --changes` used to silently skip brand-new files
		// a user had written but not yet `git add`-ed.
		write(tmpDir, "fresh.ts", "export const fresh = 1;\n");

		const files = getChangedFiles(tmpDir);
		expect(files).toContain(path.join(tmpDir, "fresh.ts"));
	});

	it("excludes gitignored untracked files", () => {
		write(tmpDir, ".gitignore", "secret.ts\n");
		git(tmpDir, ["add", ".gitignore"]);
		write(tmpDir, "secret.ts", "export const secret = 1;\n");

		const files = getChangedFiles(tmpDir);
		expect(files).not.toContain(path.join(tmpDir, "secret.ts"));
	});

	it("deduplicates files present in both diff and untracked outputs", () => {
		write(tmpDir, "a.ts", "export const a = 1;\n");
		git(tmpDir, ["add", "a.ts"]);

		const files = getChangedFiles(tmpDir);
		const matches = files.filter((f) => f === path.join(tmpDir, "a.ts"));
		expect(matches).toHaveLength(1);
	});

	it("returns [] outside a git repository", () => {
		const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-git-nonrepo-"));
		try {
			expect(getChangedFiles(nonRepo)).toEqual([]);
		} finally {
			fs.rmSync(nonRepo, { recursive: true, force: true });
		}
	});
});

describe("getStagedFiles", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-git-staged-"));
		git(tmpDir, ["init"]);
		git(tmpDir, ["config", "user.email", "test@example.com"]);
		git(tmpDir, ["config", "user.name", "test"]);
		git(tmpDir, ["config", "commit.gpgsign", "false"]);
		write(tmpDir, "base.ts", "export const base = 1;\n");
		git(tmpDir, ["add", "base.ts"]);
		git(tmpDir, ["commit", "-m", "init", "--no-verify"]);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns only staged files (not unstaged mods or untracked)", () => {
		write(tmpDir, "staged.ts", "export const staged = 1;\n");
		git(tmpDir, ["add", "staged.ts"]);
		write(tmpDir, "base.ts", "export const base = 2;\n");
		write(tmpDir, "untracked.ts", "export const untracked = 1;\n");

		const files = getStagedFiles(tmpDir);
		expect(files).toContain(path.join(tmpDir, "staged.ts"));
		expect(files).not.toContain(path.join(tmpDir, "base.ts"));
		expect(files).not.toContain(path.join(tmpDir, "untracked.ts"));
	});
});
