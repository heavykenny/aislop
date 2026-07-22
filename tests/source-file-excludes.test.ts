import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filterEnumeratedProjectFiles } from "../src/utils/source-files.js";

describe("exclude pattern normalization", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-source-excludes-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	const createFile = (relativePath: string): void => {
		const absolutePath = path.join(tmpDir, relativePath);
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
		fs.writeFileSync(absolutePath, "export const value = true;\n", "utf-8");
	};

	it.each([
		[".idea", ["src/app.ts"]],
		[".idea/", ["src/app.ts"]],
		["./.idea", ["src/app.ts"]],
		["apps/web/.idea", [".idea/project.ts", "src/app.ts"]],
	])("excludes dot-directory descendants for literal %s", (exclude, expectedFiles) => {
		createFile(".idea/project.ts");
		createFile("apps/web/.idea/workspace.ts");
		createFile("src/app.ts");

		const filtered = filterEnumeratedProjectFiles(
			tmpDir,
			[".idea/project.ts", "apps/web/.idea/workspace.ts", "src/app.ts"],
			[],
			[exclude],
		);

		expect(filtered.sort()).toEqual(expectedFiles.map((file) => path.join(tmpDir, file)).sort());
	});

	it("preserves root and nested dotfile exclusion", () => {
		createFile(".hidden.ts");
		createFile("src/.hidden.ts");
		createFile("src/app.ts");

		const filtered = filterEnumeratedProjectFiles(
			tmpDir,
			[".hidden.ts", "src/.hidden.ts", "src/app.ts"],
			[],
			[".hidden.ts"],
		);

		expect(filtered).toEqual([path.join(tmpDir, "src/app.ts")]);
	});

	it.each(["", "   ", "./", "/", "///"])("ignores empty or root-like exclusion %j", (exclude) => {
		createFile("src/app.ts");

		const filtered = filterEnumeratedProjectFiles(tmpDir, ["src/app.ts"], [], [exclude]);

		expect(filtered).toEqual([path.join(tmpDir, "src/app.ts")]);
	});
});
