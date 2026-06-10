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

	it("includes tracked source files even when gitignore matches them", async () => {
		createFile(tmpDir, ".gitignore", "ignored.ts\nignored-dir/\nignored-untracked.ts\n");
		createFile(tmpDir, "src/app.ts", "export const app = true;\n");
		createFile(tmpDir, "src/worker.ts", "export const worker = true;\n");
		createFile(tmpDir, "src/app.test.ts", "export const testFile = true;\n");
		createFile(tmpDir, "tests/helper.ts", "export const helper = true;\n");
		createFile(tmpDir, "ignored.ts", "export const ignored = true;\n");
		createFile(tmpDir, "ignored-dir/task.ts", "export const ignoredTask = true;\n");
		createFile(tmpDir, "ignored-untracked.ts", "export const untracked = true;\n");

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
				path.join(tmpDir, "ignored-dir/task.ts"),
				path.join(tmpDir, "ignored.ts"),
				path.join(tmpDir, "src/app.ts"),
				path.join(tmpDir, "src/worker.ts"),
			].sort(),
		);

		const filteredFiles = filterProjectFiles(tmpDir, [
			path.join(tmpDir, "src/app.ts"),
			path.join(tmpDir, "src/app.test.ts"),
			path.join(tmpDir, "tests/helper.ts"),
			path.join(tmpDir, "ignored.ts"),
			path.join(tmpDir, "ignored-untracked.ts"),
		]);

		expect(filteredFiles).toEqual([
			path.join(tmpDir, "src/app.ts"),
			path.join(tmpDir, "ignored.ts"),
		]);

		const project = await discoverProject(tmpDir);
		expect(project.sourceFileCount).toBe(4);
	});

	it("skips symlinked source files even when they look in-scope", () => {
		const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-source-outside-"));
		const outsideFile = path.join(outsideDir, "target.py");
		fs.writeFileSync(outsideFile, "import os\nprint('outside')\n", "utf-8");

		createFile(tmpDir, "src/app.py", "print('app')\n");
		fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
		fs.symlinkSync(outsideFile, path.join(tmpDir, "src/escape.py"));

		git(tmpDir, ["add", "src/app.py", "src/escape.py"]);

		const sourceFiles = getSourceFilesForRoot(tmpDir).sort();
		const explicitFiles = filterProjectFiles(tmpDir, [
			path.join(tmpDir, "src/app.py"),
			path.join(tmpDir, "src/escape.py"),
		]);

		expect(sourceFiles).toEqual([path.join(tmpDir, "src/app.py")]);
		expect(explicitFiles).toEqual([path.join(tmpDir, "src/app.py")]);
		expect(fs.readFileSync(outsideFile, "utf-8")).toBe("import os\nprint('outside')\n");

		fs.rmSync(outsideDir, { recursive: true, force: true });
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
		createFile(tmpDir, "app/bundles/ApiBundle/Tests/Functional/ControllerTest.php", "<?php\n");
		createFile(tmpDir, "tutorials/lesson.py", "print('tutorial')\n");
		createFile(tmpDir, "code_samples/demo.py", "print('sample')\n");
		createFile(tmpDir, ".agents/skills/example.py", "print('skill')\n");
		createFile(tmpDir, ".pnpm-store/v10/files/aa/package.ts", "export const cached = true;\n");

		const sourceFiles = getSourceFilesForRoot(tmpDir).sort();

		expect(sourceFiles).toEqual([path.join(tmpDir, "src/app.py")]);
	});

	it("keeps public assets in zero-config scans so security checks cover shipped code", () => {
		createFile(tmpDir, "src/app.js", "export const app = true;\n");
		createFile(tmpDir, "public/vuln.js", "eval(userInput);\n");

		const sourceFiles = getSourceFilesForRoot(tmpDir).sort();

		expect(sourceFiles).toEqual(
			[path.join(tmpDir, "public/vuln.js"), path.join(tmpDir, "src/app.js")].sort(),
		);
	});

	it("skips checked-in package manager and generated dependency artifacts", () => {
		createFile(tmpDir, "src/app.ts", "export const app = true;\n");
		createFile(tmpDir, "src/components/Button.stories.tsx", "export const Story = {};\n");
		createFile(tmpDir, "src/components/__stories__/Button.tsx", "export const Story = {};\n");
		createFile(tmpDir, "packages/sdk/src/metadata/generated/schema.ts", "export const generated = true;\n");
		createFile(tmpDir, "backend/app/DomainObjects/Generated/Model.php", "<?php\n");
		createFile(tmpDir, "src/parser/testdata/case.go", "package testdata\n");
		createFile(tmpDir, "e2e/fixtures.ts", "export const fixture = true;\n");
		createFile(tmpDir, "library/js/vendors/validate/plugin.js", "validate.extend({});\n");
		createFile(tmpDir, "third_party/legacy/widget.js", "window.widget = true;\n");
		createFile(tmpDir, ".yarn/releases/yarn-4.13.0.cjs", "// yarn release bundle\n");
		createFile(
			tmpDir,
			"packages/app/constants/yarn-engine/.yarn/releases/yarn-4.9.2.cjs",
			"// embedded yarn release bundle\n",
		);
		createFile(tmpDir, ".pnp.cjs", "// yarn pnp loader\n");
		createFile(tmpDir, ".pnp.loader.mjs", "// yarn pnp esm loader\n");
		createFile(
			tmpDir,
			"Documentation/EHI_Export/schemaspy/layout/schemaSpy.js",
			"$(function () {});\n",
		);
		createFile(
			tmpDir,
			"Documentation/EHI_Export/schemaspy/layout/bower/jquery/jquery.js",
			"window.jQuery = window.jQuery || {};\n",
		);
		createFile(tmpDir, "assets/bower_components/legacy/plugin.js", "define(function () {});\n");
		createFile(tmpDir, "assets/jspm_packages/npm/pkg/index.js", "System.register([]);\n");

		git(tmpDir, ["add", "-f", "."]);

		const sourceFiles = getSourceFilesForRoot(tmpDir).sort();

		expect(sourceFiles).toEqual([path.join(tmpDir, "src/app.ts")]);
	});

	it("keeps timestamp-named JavaScript files in shared scan coverage", () => {
		createFile(tmpDir, "src/app.ts", "export const app = true;\n");
		createFile(
			tmpDir,
			"apps/admin/vite.config.ts.timestamp-1735325995918-46a167c39672.mjs",
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
			"apps/admin/vite.config.ts.timestamp-1735325995918-46a167c39672.mjs",
			"apps/web/vite.config.ts.timestamp-1700000000000-abc123def456.cjs",
			"src/normal.timestamp-1.mjs",
		]);
		git(tmpDir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "seed"]);

		const sourceFiles = getSourceFilesForRoot(tmpDir).sort();

		expect(sourceFiles).toEqual(
			[
				path.join(tmpDir, "apps/admin/vite.config.ts.timestamp-1735325995918-46a167c39672.mjs"),
				path.join(tmpDir, "apps/web/vite.config.ts.timestamp-1700000000000-abc123def456.cjs"),
				path.join(tmpDir, "src/app.ts"),
				path.join(tmpDir, "src/normal.timestamp-1.mjs"),
			].sort(),
		);
	});

	it("does not let Biome exclusions remove files from zero-config scans", () => {
		createFile(
			tmpDir,
			"biome.json",
			JSON.stringify({
				files: {
					includes: ["**", "!src/vulnerable.ts"],
				},
			}),
		);
		createFile(tmpDir, "src/app.ts", "export const app = true;\n");
		createFile(tmpDir, "src/vulnerable.ts", "export const secret = 'scan me';\n");

		const sourceFiles = getSourceFilesForRoot(tmpDir).sort();

		expect(sourceFiles).toEqual(
			[path.join(tmpDir, "src/app.ts"), path.join(tmpDir, "src/vulnerable.ts")].sort(),
		);
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
