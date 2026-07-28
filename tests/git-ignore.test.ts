import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	dropGitIgnoredPaths,
	getIgnoredPaths,
	resetGitIgnoreCacheForTests,
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
