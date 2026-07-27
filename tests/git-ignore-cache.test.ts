import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	dropGitIgnoredPaths,
	getIgnoredPaths,
	resetGitIgnoreCacheForTests,
} from "../src/utils/git-ignore.js";

const { spawnSync } = vi.hoisted(() => ({ spawnSync: vi.fn() }));

vi.mock("node:child_process", () => ({ spawnSync }));

interface SpawnOptions {
	input: string;
}

const requestedPathsOf = (callIndex: number): string[] => {
	const options = spawnSync.mock.calls[callIndex][2] as SpawnOptions;
	return options.input.split("\n").filter((line) => line.length > 0);
};

// Stand in for `git check-ignore --stdin`: echo back the requested paths that are
// ignored, exit 1 when none of them are.
const gitIgnores = (ignoredPaths: string[]): void => {
	const ignored = new Set(ignoredPaths);
	spawnSync.mockImplementation((_command, _args, options) => {
		const requested = (options as SpawnOptions).input.split("\n").filter((line) => line.length > 0);
		const matched = requested.filter((line) => ignored.has(line));
		return {
			status: matched.length > 0 ? 0 : 1,
			stdout: matched.map((line) => `${line}\n`).join(""),
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

describe("getIgnoredPaths caching", () => {
	it("classifies a repeated path through git only once", () => {
		gitIgnores(["build/output.js"]);
		const root = "/repo";
		const files = ["source/main.ts", "build/output.js"];

		expect(getIgnoredPaths(root, files)).toEqual(new Set(["build/output.js"]));
		expect(getIgnoredPaths(root, files)).toEqual(new Set(["build/output.js"]));
		expect(getIgnoredPaths(root, ["source/main.ts"])).toEqual(new Set<string>());
		expect(spawnSync).toHaveBeenCalledTimes(1);
	});

	it("sends only the new paths when a later call is a superset", () => {
		gitIgnores(["build/output.js", "vendor/library.ts"]);
		const root = "/repo";

		expect(getIgnoredPaths(root, ["source/main.ts", "build/output.js"])).toEqual(
			new Set(["build/output.js"]),
		);
		expect(
			getIgnoredPaths(root, [
				"source/main.ts",
				"build/output.js",
				"vendor/library.ts",
				"source/helper.ts",
			]),
		).toEqual(new Set(["build/output.js", "vendor/library.ts"]));

		expect(spawnSync).toHaveBeenCalledTimes(2);
		expect(requestedPathsOf(0)).toEqual(["source/main.ts", "build/output.js"]);
		expect(requestedPathsOf(1)).toEqual(["vendor/library.ts", "source/helper.ts"]);
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
		gitIgnores(["build/output.js"]);

		expect(getIgnoredPaths("/first", ["build/output.js"])).toEqual(new Set(["build/output.js"]));
		gitIgnores([]);
		expect(getIgnoredPaths("/second", ["build/output.js"])).toEqual(new Set<string>());
		expect(getIgnoredPaths("/first", ["build/output.js"])).toEqual(new Set(["build/output.js"]));

		expect(spawnSync).toHaveBeenCalledTimes(2);
	});

	it("treats an unresolved root as the resolved one", () => {
		gitIgnores(["build/output.js"]);
		const root = path.resolve("/repo/project");

		expect(getIgnoredPaths(root, ["build/output.js"])).toEqual(new Set(["build/output.js"]));
		expect(getIgnoredPaths(path.join(root, "nested", ".."), ["build/output.js"])).toEqual(
			new Set(["build/output.js"]),
		);
		expect(spawnSync).toHaveBeenCalledTimes(1);
	});

	it("shares the cache with dropGitIgnoredPaths", () => {
		gitIgnores(["build/output.js"]);
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
		expect(spawnSync).toHaveBeenCalledTimes(1);
	});

	it("re-queries git after the cache is reset", () => {
		gitIgnores(["build/output.js"]);
		const root = "/repo";

		expect(getIgnoredPaths(root, ["build/output.js"])).toEqual(new Set(["build/output.js"]));
		resetGitIgnoreCacheForTests();
		expect(getIgnoredPaths(root, ["build/output.js"])).toEqual(new Set(["build/output.js"]));
		expect(spawnSync).toHaveBeenCalledTimes(2);
	});

	it("re-queries a failed root after the cache is reset", () => {
		gitFails();
		const root = "/repo";

		expect(getIgnoredPaths(root, ["build/output.js"])).toEqual(new Set<string>());
		resetGitIgnoreCacheForTests();
		gitIgnores(["build/output.js"]);
		expect(getIgnoredPaths(root, ["build/output.js"])).toEqual(new Set(["build/output.js"]));
		expect(spawnSync).toHaveBeenCalledTimes(2);
	});

	it("never spawns git for an empty request", () => {
		gitIgnores([]);

		expect(getIgnoredPaths("/repo", [])).toEqual(new Set<string>());
		expect(dropGitIgnoredPaths("/repo", [])).toEqual([]);
		expect(spawnSync).not.toHaveBeenCalled();
	});
});
