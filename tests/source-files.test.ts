import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverProject } from "../src/utils/discover.js";
import {
	filterProjectFiles,
	getSourceFilesForRoot,
	readAislopIgnorePatterns,
} from "../src/utils/source-files.js";

const createFile = (rootDir: string, filePath: string, content = "") => {
	const absolutePath = path.join(rootDir, filePath);
	fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
	fs.writeFileSync(absolutePath, content, "utf-8");
};

const git = (cwd: string, args: string[]) => {
	execFileSync("git", args, { cwd, stdio: "ignore" });
};

describe("source file selection", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-source-files-"));
		git(tmpDir, ["init"]);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("ignores test files and gitignored paths, even when they are tracked", async () => {
		createFile(tmpDir, ".gitignore", "ignored.ts\nignored-dir/\n");
		createFile(tmpDir, "src/app.ts", "export const app = true;\n");
		createFile(tmpDir, "src/worker.ts", "export const worker = true;\n");
		createFile(tmpDir, "src/app.test.ts", "export const testFile = true;\n");
		createFile(tmpDir, "tests/helper.ts", "export const helper = true;\n");
		createFile(tmpDir, "ignored.ts", "export const ignored = true;\n");
		createFile(tmpDir, "ignored-dir/task.ts", "export const ignoredTask = true;\n");

		git(tmpDir, [
			"add",
			"-f",
			".gitignore",
			"src/app.ts",
			"src/worker.ts",
			"src/app.test.ts",
			"tests/helper.ts",
			"ignored.ts",
			"ignored-dir/task.ts",
		]);

		const sourceFiles = getSourceFilesForRoot(tmpDir).sort();

		expect(sourceFiles).toEqual(
			[path.join(tmpDir, "src/app.ts"), path.join(tmpDir, "src/worker.ts")].sort(),
		);

		const filteredFiles = filterProjectFiles(tmpDir, [
			path.join(tmpDir, "src/app.ts"),
			path.join(tmpDir, "src/app.test.ts"),
			path.join(tmpDir, "tests/helper.ts"),
			path.join(tmpDir, "ignored.ts"),
		]);

		expect(filteredFiles).toEqual([path.join(tmpDir, "src/app.ts")]);

		const project = await discoverProject(tmpDir);
		expect(project.sourceFileCount).toBe(2);
	});

	it("filters out files that no longer exist on disk", () => {
		createFile(tmpDir, "src/a.ts", "export const a = 1;\n");
		const result = filterProjectFiles(tmpDir, [
			path.join(tmpDir, "src/a.ts"),
			path.join(tmpDir, "src/deleted.ts"),
		]);
		expect(result).toEqual([path.join(tmpDir, "src/a.ts")]);
	});

	it("skips common docs, tutorial, and sample code paths in zero-config scans", () => {
		createFile(tmpDir, "src/app.py", "print('app')\n");
		createFile(tmpDir, "tutorials/lesson.py", "print('tutorial')\n");
		createFile(tmpDir, "code_samples/demo.py", "print('sample')\n");
		createFile(tmpDir, ".agents/skills/example.py", "print('skill')\n");
		createFile(tmpDir, ".pnpm-store/v10/files/aa/package.ts", "export const cached = true;\n");

		const sourceFiles = getSourceFilesForRoot(tmpDir).sort();

		expect(sourceFiles).toEqual([path.join(tmpDir, "src/app.py")]);
	});

	it("excludes Vite config-bundle timestamp cache files even when tracked", () => {
		createFile(tmpDir, "src/app.ts", "export const app = true;\n");
		createFile(
			tmpDir,
			"apps/storybook/vite.config.ts.timestamp-1735325995918-46a167c39672.mjs",
			"// vite cache\n",
		);
		createFile(
			tmpDir,
			"apps/web/vite.config.ts.timestamp-1700000000000-abc123def456.cjs",
			"// vite cache\n",
		);
		createFile(tmpDir, "src/normal.timestamp-1.mjs", "// not a cache file\n");

		git(tmpDir, [
			"add",
			"-f",
			"src/app.ts",
			"apps/storybook/vite.config.ts.timestamp-1735325995918-46a167c39672.mjs",
			"apps/web/vite.config.ts.timestamp-1700000000000-abc123def456.cjs",
			"src/normal.timestamp-1.mjs",
		]);
		git(tmpDir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "seed"]);

		const sourceFiles = getSourceFilesForRoot(tmpDir).sort();

		expect(sourceFiles).toEqual([
			path.join(tmpDir, "src/app.ts"),
			path.join(tmpDir, "src/normal.timestamp-1.mjs"),
		]);
	});

	it("honors Biome file exclusions in zero-config scans", () => {
		createFile(
			tmpDir,
			"biome.json",
			JSON.stringify({
				files: {
					includes: ["**", "!packages/ui/src/auto-imports.d.ts"],
				},
			}),
		);
		createFile(tmpDir, "src/app.ts", "export const app = true;\n");
		createFile(tmpDir, "packages/ui/src/auto-imports.d.ts", "declare const IconThing: unknown;\n");

		const sourceFiles = getSourceFilesForRoot(tmpDir).sort();

		expect(sourceFiles).toEqual([path.join(tmpDir, "src/app.ts")]);
	});

	it("reads .aislopignore patterns, skipping blanks and comments", () => {
		createFile(tmpDir, ".aislopignore", "# generated code\nlegacy\n\nsrc/api.generated.ts\n");

		expect(readAislopIgnorePatterns(tmpDir)).toEqual(["legacy", "src/api.generated.ts"]);
	});

	it("excludes files matched by .aislopignore patterns", () => {
		createFile(tmpDir, ".aislopignore", "legacy\nsrc/api.generated.ts\n");
		createFile(tmpDir, "src/app.ts", "export const app = true;\n");
		createFile(tmpDir, "legacy/old.ts", "export const old = true;\n");
		createFile(tmpDir, "src/api.generated.ts", "export const gen = true;\n");

		const filtered = filterProjectFiles(
			tmpDir,
			[
				path.join(tmpDir, "src/app.ts"),
				path.join(tmpDir, "legacy/old.ts"),
				path.join(tmpDir, "src/api.generated.ts"),
			],
			[],
			readAislopIgnorePatterns(tmpDir),
		);

		expect(filtered).toEqual([path.join(tmpDir, "src/app.ts")]);
	});
});
