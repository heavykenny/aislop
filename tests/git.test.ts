import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/engines/types.js";
import { classifyChangeContext, parseUnifiedDiffHunks } from "../src/utils/change-context.js";
import { getChangedFiles, getChangedLineMap, getStagedFiles } from "../src/utils/git.js";

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

const sampleDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
	filePath: "src/app.ts",
	engine: "ai-slop",
	rule: "ai-slop/unsafe-type-assertion",
	severity: "warning",
	message: "unsafe",
	help: "",
	line: 2,
	column: 1,
	category: "types",
	fixable: false,
	...overrides,
});

describe("changed-line hunk classification", () => {
	it("classifies added and modified new-file lines, deleted-only hunks, and file-level findings", () => {
		const diff = [
			"diff --git a/src/app.ts b/src/app.ts",
			"--- a/src/app.ts",
			"+++ b/src/app.ts",
			"@@ -1,1 +1,1 @@",
			"-export const a = 1;",
			"+export const a = 2;",
			"@@ -10,2 +10,0 @@",
			"-gone",
			"-also",
			"diff --git a/src/new.ts b/src/new.ts",
			"new file mode 100644",
			"--- /dev/null",
			"+++ b/src/new.ts",
			"@@ -0,0 +1,2 @@",
			"+one",
			"+two",
		].join("\n");
		const map = parseUnifiedDiffHunks(diff);
		const root = "/repo";

		expect(classifyChangeContext(sampleDiagnostic({ line: 1 }), map, root)).toBe("changed-line");
		expect(classifyChangeContext(sampleDiagnostic({ line: 4 }), map, root)).toBe(
			"existing-file-context",
		);
		expect(classifyChangeContext(sampleDiagnostic({ line: 0 }), map, root)).toBe("unknown");
		expect(
			classifyChangeContext(sampleDiagnostic({ filePath: "src/new.ts", line: 2 }), map, root),
		).toBe("changed-line");
		expect(
			classifyChangeContext(sampleDiagnostic({ filePath: "src\\new.ts", line: 1 }), map, root),
		).toBe("changed-line");
	});

	it("parses hunks when the user has git colour forced on", () => {
		// color.ui=always puts ANSI escapes ahead of the +++ and @@ markers, which hides
		// every file and range from the hunk parser.
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-git-color-"));
		try {
			git(tmpDir, ["init"]);
			git(tmpDir, ["config", "user.email", "test@example.com"]);
			git(tmpDir, ["config", "user.name", "test"]);
			git(tmpDir, ["config", "commit.gpgsign", "false"]);
			git(tmpDir, ["config", "color.ui", "always"]);
			git(tmpDir, ["config", "color.diff", "always"]);
			write(tmpDir, "app.ts", "export const a = 1;\nexport const b = 2;\n");
			git(tmpDir, ["add", "app.ts"]);
			git(tmpDir, ["commit", "-m", "init", "--no-verify"]);
			write(tmpDir, "app.ts", "export const a = 1;\nexport const b = 3;\n");

			const map = getChangedLineMap(tmpDir);

			expect(map.get("app.ts")?.kind).toBe("hunks");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("maps renamed files to the new path and treats untracked files as whole-file changes", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-git-hunks-"));
		try {
			git(tmpDir, ["init"]);
			git(tmpDir, ["config", "user.email", "test@example.com"]);
			git(tmpDir, ["config", "user.name", "test"]);
			git(tmpDir, ["config", "commit.gpgsign", "false"]);
			write(tmpDir, "old.ts", "export const value = 1;\nexport const keep = 2;\n");
			git(tmpDir, ["add", "old.ts"]);
			git(tmpDir, ["commit", "-m", "init", "--no-verify"]);
			git(tmpDir, ["mv", "old.ts", "renamed.ts"]);
			write(tmpDir, "fresh.ts", "export const fresh = 1;\n");
			const map = getChangedLineMap(tmpDir);
			expect(map.get("renamed.ts")?.kind).toBe("hunks");
			expect(map.get("fresh.ts")).toEqual({ kind: "all" });
			expect(
				classifyChangeContext(sampleDiagnostic({ filePath: "renamed.ts", line: 1 }), map, tmpDir),
			).toBe("existing-file-context");
			expect(
				classifyChangeContext(sampleDiagnostic({ filePath: "fresh.ts", line: 1 }), map, tmpDir),
			).toBe("changed-line");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
