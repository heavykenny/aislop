import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	dropGitIgnoredPaths,
	getIgnoredPaths,
	resetGitIgnoreCacheForTests,
	resetGitIgnoreSnapshots,
} from "../src/utils/git-ignore.js";

const write = (root: string, relativePath: string, body: string): string => {
	const absolutePath = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
	fs.writeFileSync(absolutePath, body, "utf-8");
	return absolutePath;
};

const git = (root: string, ...gitArguments: string[]): void => {
	execFileSync("git", gitArguments, { cwd: root, stdio: "ignore" });
};

// What the implementation replaced. core.quotepath=false stops git from re-encoding
// non-ASCII names as C-style escapes, which is the same hazard -z avoids for ls-files.
const checkIgnore = (root: string, files: string[]): Set<string> => {
	const gitArguments = ["-c", "core.quotepath=false", "check-ignore", "--stdin"];
	const options = { cwd: root, encoding: "utf-8" as const, input: files.join("\n") };
	// check-ignore exits 1 when it ignores nothing, which execFileSync reports as a throw
	// carrying the (empty) output.
	let stdout: string;
	try {
		stdout = execFileSync("git", gitArguments, options);
	} catch (error) {
		stdout = (error as { stdout: string }).stdout;
	}
	return new Set(stdout.split("\n").filter((line) => line.length > 0));
};

describe("getIgnoredPaths against a real repository", () => {
	let root: string;

	beforeEach(() => {
		root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aislop-git-ignore-")));
		git(root, "init");
		write(root, ".gitignore", "build/\n*.generated.ts\nsecret.txt\ntëst.txt\n");
		write(root, "source/main.ts", "export const main = true;\n");
		write(root, "source/model.generated.ts", "export const model = true;\n");
		write(root, "build/output.ts", "export const output = true;\n");
		resetGitIgnoreCacheForTests();
	});

	afterEach(() => {
		resetGitIgnoreCacheForTests();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("classifies the same paths on a cached second pass", () => {
		const files = ["source/main.ts", "source/model.generated.ts", "build/output.ts"];
		const expected = new Set(["source/model.generated.ts", "build/output.ts"]);

		expect(getIgnoredPaths(root, files)).toEqual(expected);
		expect(getIgnoredPaths(root, files)).toEqual(expected);
		expect(getIgnoredPaths(root, ["source/main.ts"])).toEqual(new Set<string>());
	});

	it("drops ignored absolute paths on both passes", () => {
		const kept = path.join(root, "source", "main.ts");
		const absolutePaths = [kept, path.join(root, "build", "output.ts")];

		expect(dropGitIgnoredPaths(root, absolutePaths)).toEqual([kept]);
		expect(dropGitIgnoredPaths(root, absolutePaths)).toEqual([kept]);
	});

	// check-ignore consults the index unless given --no-index, so adding a matching file
	// takes it out of the ignored set. Listing --cached alongside --others reproduces that.
	it("keeps a tracked file that matches an ignore pattern", () => {
		write(root, "secret.txt", "token\n");
		git(root, "add", "-f", "secret.txt");
		resetGitIgnoreCacheForTests();

		const files = ["secret.txt", "source/main.ts", "build/output.ts"];
		expect(getIgnoredPaths(root, files)).toEqual(new Set(["build/output.ts"]));
		expect(getIgnoredPaths(root, files)).toEqual(checkIgnore(root, files));
	});

	it("classifies a non-ASCII name that a quoted listing would mangle", () => {
		write(root, "tëst.txt", "value\n");
		write(root, "kept.ts", "export const kept = true;\n");
		resetGitIgnoreCacheForTests();

		const files = ["tëst.txt", "kept.ts"];
		expect(getIgnoredPaths(root, files)).toEqual(new Set(["tëst.txt"]));
		expect(getIgnoredPaths(root, files)).toEqual(checkIgnore(root, files));
	});

	it("applies a nested .gitignore to its own subtree only", () => {
		write(root, "package/.gitignore", "local.ts\n");
		write(root, "package/local.ts", "export const local = true;\n");
		write(root, "package/shared.ts", "export const shared = true;\n");
		write(root, "other/local.ts", "export const other = true;\n");
		resetGitIgnoreCacheForTests();

		const files = ["package/local.ts", "package/shared.ts", "other/local.ts"];
		expect(getIgnoredPaths(root, files)).toEqual(new Set(["package/local.ts"]));
		expect(getIgnoredPaths(root, files)).toEqual(checkIgnore(root, files));
	});

	it("keeps every path outside a git repository", () => {
		const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aislop-no-repo-")));
		try {
			expect(getIgnoredPaths(outside, ["build/output.ts"])).toEqual(new Set<string>());
			expect(dropGitIgnoredPaths(outside, [path.join(outside, "build", "output.ts")])).toEqual([
				path.join(outside, "build", "output.ts"),
			]);
		} finally {
			fs.rmSync(outside, { recursive: true, force: true });
		}
	});
});

describe("getIgnoredPaths honors core.ignorecase", () => {
	let root: string;

	beforeEach(() => {
		root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aislop-git-ignorecase-")));
		git(root, "init");
		resetGitIgnoreCacheForTests();
	});

	afterEach(() => {
		resetGitIgnoreCacheForTests();
		fs.rmSync(root, { recursive: true, force: true });
	});

	// Windows and macOS default core.ignorecase to true because their filesystems are
	// case-insensitive. A tracked file that later undergoes an in-place case-only rename
	// on such a filesystem keeps its old casing in the index (git treats the rename as a
	// no-op), so a real filesystem walker hands the snapshot a candidate whose case
	// differs from the index entry. check-ignore honors core.ignorecase in that lookup,
	// and the snapshot's Set membership test must too.
	it("folds ASCII case when core.ignorecase is true", () => {
		git(root, "config", "core.ignorecase", "true");
		write(root, "Tracked.ts", "export const tracked = true;\n");
		git(root, "add", "Tracked.ts");
		resetGitIgnoreCacheForTests();

		expect(getIgnoredPaths(root, ["tracked.ts"])).toEqual(new Set<string>());
	});

	// Sibling of the test above with core.ignorecase explicitly false, locking that
	// folding only happens when git itself would fold.
	it("stays case-sensitive when core.ignorecase is false", () => {
		git(root, "config", "core.ignorecase", "false");
		write(root, "Tracked.ts", "export const tracked = true;\n");
		git(root, "add", "Tracked.ts");
		resetGitIgnoreCacheForTests();

		expect(getIgnoredPaths(root, ["tracked.ts"])).toEqual(new Set(["tracked.ts"]));
	});

	// git's own case fold (wildmatch's WM_CASEFOLD, the index name-hash) is byte-wise
	// ASCII only, so a differently-cased non-ASCII byte must still read as a distinct,
	// missing path even under core.ignorecase=true. This is what rules out
	// String.prototype.toLowerCase, which would fold U+00DC to U+00FC and hide the gap.
	it("does not fold non-ASCII case even when core.ignorecase is true", () => {
		git(root, "config", "core.ignorecase", "true");
		write(root, "Übung.ts", "export const uebung = true;\n");
		git(root, "add", "Übung.ts");
		resetGitIgnoreCacheForTests();

		expect(getIgnoredPaths(root, ["übung.ts"])).toEqual(new Set(["übung.ts"]));
	});
});

describe("resetGitIgnoreSnapshots invalidates the process-global cache across scans", () => {
	let root: string;

	beforeEach(() => {
		root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aislop-git-ignore-reset-")));
		git(root, "init");
		write(root, "existing.ts", "export const existing = true;\n");
		resetGitIgnoreCacheForTests();
	});

	afterEach(() => {
		resetGitIgnoreCacheForTests();
		fs.rmSync(root, { recursive: true, force: true });
	});

	// The snapshot is a process-global cache with no expiry of its own; a long-lived
	// process (the MCP server, an interactive watch loop) that never calls the reset
	// keeps answering scan 2 from scan 1's listing. discoverProject calls
	// resetGitIgnoreSnapshots at the top of every scan specifically to avoid this.
	it("misclassifies a file created after the snapshot until the cache is reset", () => {
		// Scan 1 builds and caches the snapshot.
		expect(getIgnoredPaths(root, ["existing.ts"])).toEqual(new Set<string>());

		// A file appears after scan 1 (a build step, an agent edit, a git pull).
		write(root, "new-file.ts", "export const created = true;\n");

		// Scan 2, same process, no reset: this is the bug. The new file is absent from
		// the stale snapshot and reads as ignored even though git does not ignore it.
		expect(getIgnoredPaths(root, ["existing.ts", "new-file.ts"])).toEqual(
			new Set(["new-file.ts"]),
		);

		// The reset a new scan performs fixes it: a fresh snapshot sees the new file.
		resetGitIgnoreSnapshots();
		expect(getIgnoredPaths(root, ["existing.ts", "new-file.ts"])).toEqual(new Set<string>());
	});
});

describe("getIgnoredPaths across an embedded repository boundary", () => {
	let root: string;
	let submoduleSource: string | undefined;

	beforeEach(() => {
		root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aislop-git-ignore-embed-")));
		git(root, "init");
		// A CI runner has no global git identity, so a bare `git commit` below would
		// exit 128 with "Author identity unknown". Match this file's other real-git
		// fixtures (see audit-scope.test.ts, git.test.ts, ci-changes-base.test.ts).
		git(root, "config", "user.email", "test@example.com");
		git(root, "config", "user.name", "test");
		write(root, ".gitignore", "*.log\n");
		write(root, "outer.ts", "export const outer = true;\n");
		git(root, "add", "outer.ts", ".gitignore");
		git(root, "commit", "-m", "outer initial");
		resetGitIgnoreCacheForTests();
	});

	afterEach(() => {
		resetGitIgnoreCacheForTests();
		fs.rmSync(root, { recursive: true, force: true });
		if (submoduleSource) fs.rmSync(submoduleSource, { recursive: true, force: true });
		submoduleSource = undefined;
	});

	// ls-files never recurses into a tracked submodule: it lists the gitlink itself (a
	// bare path, no trailing slash) and nothing beneath it, so a plain miss on
	// "sub/inner.ts" would read as ignored without the ancestor-prefix fallback in
	// isBeneathEmbeddedRepository. Ground truth here cannot come from check-ignore: it
	// refuses outright for a path inside a submodule (`fatal: Pathspec 'sub/inner.ts' is
	// in submodule 'sub'`, exit 128, for both a single path and a --stdin batch that
	// includes one), which is exactly why the fix has to be structural rather than
	// deferring to git for an answer.
	//
	// protocol.file.allow=always is required because git 2.38+ blocks the file://
	// transport `submodule add` uses for a same-machine path by default; without it this
	// test breaks in CI on a current git.
	it("keeps a file inside a tracked submodule", () => {
		submoduleSource = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), "aislop-submodule-src-")),
		);
		git(submoduleSource, "init");
		git(submoduleSource, "config", "user.email", "test@example.com");
		git(submoduleSource, "config", "user.name", "test");
		write(submoduleSource, "inner.ts", "export const inner = true;\n");
		git(submoduleSource, "add", "inner.ts");
		git(submoduleSource, "commit", "-m", "submodule content");

		git(root, "-c", "protocol.file.allow=always", "submodule", "add", submoduleSource, "sub");
		resetGitIgnoreCacheForTests();

		expect(getIgnoredPaths(root, ["outer.ts", "sub/inner.ts"])).toEqual(new Set<string>());
	});

	// An untracked nested repository (a directory holding its own .git, never added as a
	// submodule) is a different ls-files shape: the directory itself, WITH a trailing
	// slash, and again nothing beneath it. Unlike a submodule, check-ignore answers
	// normally for a path inside one (no fatal exit), so this test can use it as ground
	// truth.
	it("keeps a file inside an untracked nested repository", () => {
		write(root, "nested-repo/nested-file.ts", "export const nested = true;\n");
		git(path.join(root, "nested-repo"), "init");
		resetGitIgnoreCacheForTests();

		const files = ["outer.ts", "nested-repo/nested-file.ts"];
		expect(getIgnoredPaths(root, files)).toEqual(new Set<string>());
		expect(getIgnoredPaths(root, files)).toEqual(checkIgnore(root, files));
	});

	it("honors outer ignore patterns inside an untracked nested repository", () => {
		write(root, ".gitignore", "*.log\nnode_modules/\n");
		write(root, "nested-repo/node_modules/x.ts", "export const dep = true;\n");
		git(path.join(root, "nested-repo"), "init");
		resetGitIgnoreCacheForTests();

		const files = ["nested-repo/node_modules/x.ts"];
		expect(checkIgnore(root, files)).toEqual(new Set(files));
		expect(getIgnoredPaths(root, files)).toEqual(checkIgnore(root, files));
	});
});
