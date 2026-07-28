import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	dropGitIgnoredPaths,
	getIgnoredPaths,
	resetGitIgnoreCacheForTests,
} from "../src/utils/git-ignore.js";

const { spawnSync } = vi.hoisted(() => ({ spawnSync: vi.fn() }));

vi.mock("node:child_process", () => ({ spawnSync }));

const NOT_IGNORED_ARGUMENTS = ["ls-files", "--cached", "--others", "--exclude-standard", "-z"];

const commandArgumentsOf = (callIndex: number): string[] =>
	spawnSync.mock.calls[callIndex][1] as string[];

// Stand in for `git ls-files --cached --others --exclude-standard -z` (the NUL-delimited
// not-ignored universe for the root) and, since a successful listing also triggers a
// core.ignorecase read, for an unconfigured `git config --type=bool core.ignorecase`
// (exit 1, matching a real repo where the key was never set).
const gitEnumerates = (notIgnoredPaths: string[]): void => {
	spawnSync.mockImplementation((_command: string, commandArguments: string[]) => {
		if (commandArguments[0] === "config") {
			return { status: 1, stdout: "", stderr: "", error: undefined };
		}
		return {
			status: 0,
			stdout: notIgnoredPaths.map((entry) => `${entry}\0`).join(""),
			stderr: "",
			error: undefined,
		};
	});
};

const gitFails = (): void => {
	spawnSync.mockImplementation(() => ({
		status: 128,
		stdout: "",
		stderr: "fatal: not a git repository\n",
		error: undefined,
	}));
};

afterEach(() => {
	spawnSync.mockReset();
	resetGitIgnoreCacheForTests();
});

describe("getIgnoredPaths snapshots", () => {
	it("takes one snapshot on the first call", () => {
		gitEnumerates(["source/main.ts"]);
		const files = ["source/main.ts", "build/output.js"];

		expect(getIgnoredPaths("/repo", files)).toEqual(new Set(["build/output.js"]));
		// One spawn for the ls-files snapshot, one for the core.ignorecase read that
		// follows a successful listing.
		expect(spawnSync).toHaveBeenCalledTimes(2);
		expect(commandArgumentsOf(0)).toEqual(NOT_IGNORED_ARGUMENTS);
		expect(spawnSync.mock.calls[0][0]).toBe("git");
	});

	it("passes the root as the working directory and no stdin", () => {
		gitEnumerates([]);
		getIgnoredPaths("/repo", ["source/main.ts"]);

		const options = spawnSync.mock.calls[0][2] as { cwd: string; input?: string };
		expect(options.cwd).toBe("/repo");
		expect(options.input).toBeUndefined();
	});

	it("answers a larger later request without spawning again", () => {
		gitEnumerates(["source/main.ts", "source/helper.ts"]);
		const root = "/repo";

		expect(getIgnoredPaths(root, ["source/main.ts", "build/output.js"])).toEqual(
			new Set(["build/output.js"]),
		);
		expect(spawnSync).toHaveBeenCalledTimes(2);

		expect(
			getIgnoredPaths(root, [
				"source/main.ts",
				"build/output.js",
				"vendor/library.ts",
				"source/helper.ts",
			]),
		).toEqual(new Set(["build/output.js", "vendor/library.ts"]));
		expect(spawnSync).toHaveBeenCalledTimes(2);
	});

	// --cached puts tracked files in the listing whether or not a pattern matches them,
	// which is how check-ignore behaves without --no-index.
	it("keeps a tracked file the listing reports", () => {
		gitEnumerates(["source/main.ts", "secret.txt"]);

		expect(getIgnoredPaths("/repo", ["source/main.ts", "secret.txt"])).toEqual(new Set<string>());
	});

	it("reads NUL-delimited records so a non-ASCII name survives", () => {
		gitEnumerates(["tëst.txt"]);

		expect(getIgnoredPaths("/repo", ["tëst.txt", "büild/output.js"])).toEqual(
			new Set(["büild/output.js"]),
		);
	});

	it("remembers a failed git invocation instead of respawning it", () => {
		gitFails();
		const root = "/not-a-repo";

		expect(getIgnoredPaths(root, ["source/main.ts"])).toEqual(new Set<string>());
		expect(getIgnoredPaths(root, ["source/main.ts", "build/output.js"])).toEqual(new Set<string>());
		expect(spawnSync).toHaveBeenCalledTimes(1);
	});

	it("remembers a spawn error instead of respawning it", () => {
		spawnSync.mockImplementation(() => ({
			status: null,
			stdout: "",
			stderr: "",
			error: new Error("spawn git ENOENT"),
		}));

		expect(getIgnoredPaths("/repo", ["build/output.js"])).toEqual(new Set<string>());
		expect(getIgnoredPaths("/repo", ["build/output.js"])).toEqual(new Set<string>());
		expect(spawnSync).toHaveBeenCalledTimes(1);
	});

	it("keeps roots independent", () => {
		gitEnumerates([]);
		expect(getIgnoredPaths("/first", ["build/output.js"])).toEqual(new Set(["build/output.js"]));

		gitEnumerates(["build/output.js"]);
		expect(getIgnoredPaths("/second", ["build/output.js"])).toEqual(new Set<string>());
		expect(getIgnoredPaths("/first", ["build/output.js"])).toEqual(new Set(["build/output.js"]));

		// Two successful snapshot builds (one per root), two spawns each.
		expect(spawnSync).toHaveBeenCalledTimes(4);
	});

	it("treats an unresolved root as the resolved one", () => {
		gitEnumerates(["source/main.ts"]);
		const root = path.resolve("/repo/project");

		expect(getIgnoredPaths(root, ["build/output.js"])).toEqual(new Set(["build/output.js"]));
		expect(getIgnoredPaths(path.join(root, "nested", ".."), ["build/output.js"])).toEqual(
			new Set(["build/output.js"]),
		);
		expect(spawnSync).toHaveBeenCalledTimes(2);
	});

	it("shares the snapshot with dropGitIgnoredPaths", () => {
		gitEnumerates(["source/main.ts"]);
		const root = path.resolve("/repo");

		expect(getIgnoredPaths(root, ["source/main.ts", "build/output.js"])).toEqual(
			new Set(["build/output.js"]),
		);
		expect(
			dropGitIgnoredPaths(root, [
				path.join(root, "source", "main.ts"),
				path.join(root, "build", "output.js"),
			]),
		).toEqual([path.join(root, "source", "main.ts")]);
		expect(spawnSync).toHaveBeenCalledTimes(2);
	});

	it("re-queries git after the cache is reset", () => {
		gitEnumerates(["source/main.ts"]);
		const root = "/repo";

		expect(getIgnoredPaths(root, ["build/output.js"])).toEqual(new Set(["build/output.js"]));
		resetGitIgnoreCacheForTests();
		expect(getIgnoredPaths(root, ["build/output.js"])).toEqual(new Set(["build/output.js"]));
		// Two successful snapshot builds (before and after the reset), two spawns each.
		expect(spawnSync).toHaveBeenCalledTimes(4);
	});

	it("re-queries a failed root after the cache is reset", () => {
		gitFails();
		const root = "/repo";

		expect(getIgnoredPaths(root, ["build/output.js"])).toEqual(new Set<string>());
		resetGitIgnoreCacheForTests();
		gitEnumerates(["build/output.js"]);
		expect(getIgnoredPaths(root, ["build/output.js"])).toEqual(new Set<string>());
		// One spawn for the failed build (no core.ignorecase read on failure), two for
		// the successful build after the reset.
		expect(spawnSync).toHaveBeenCalledTimes(3);
	});

	it("never spawns git for an empty request", () => {
		gitEnumerates([]);

		expect(getIgnoredPaths("/repo", [])).toEqual(new Set<string>());
		expect(dropGitIgnoredPaths("/repo", [])).toEqual([]);
		expect(spawnSync).not.toHaveBeenCalled();
	});
});
