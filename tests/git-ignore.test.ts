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

describe("getIgnoredPaths against a real repository", () => {
	let root: string;

	beforeEach(() => {
		root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aislop-git-ignore-")));
		execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
		write(root, ".gitignore", "build/\n*.generated.ts\n");
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
