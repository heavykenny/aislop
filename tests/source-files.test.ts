import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverProject } from "../src/utils/discover.js";
import {
	filterProjectFiles,
	getSourceFilesForRoot,
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
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "slop-source-files-"));
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
		createFile(
			tmpDir,
			"ignored-dir/task.ts",
			"export const ignoredTask = true;\n",
		);

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
			[
				path.join(tmpDir, "src/app.ts"),
				path.join(tmpDir, "src/worker.ts"),
			].sort(),
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
});
