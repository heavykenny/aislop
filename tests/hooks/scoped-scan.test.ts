import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveHookFiles, runScopedScan } from "../../src/hooks/io/scoped-scan.js";

const { spawnSync } = vi.hoisted(() => ({
	spawnSync: vi.fn(() => {
		throw new Error("automatic hook scans must not spawn subprocesses");
	}),
}));

vi.mock("node:child_process", () => ({ spawnSync }));

const tempDirs: string[] = [];

const makeTempProject = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-hook-safe-"));
	tempDirs.push(dir);
	return dir;
};

afterEach(() => {
	spawnSync.mockClear();
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("runScopedScan", () => {
	it("does not fall back to Git when the hook payload has no usable files", () => {
		const root = makeTempProject();
		const missing = path.join(root, "missing.ts");

		expect(resolveHookFiles(root, [missing])).toEqual([]);
		expect(resolveHookFiles(root, [])).toEqual([]);
		expect(spawnSync).not.toHaveBeenCalled();
	});

	it("rejects an existing absolute file outside the hook cwd", () => {
		const root = makeTempProject();
		const outsideRoot = makeTempProject();
		const outsideFile = path.join(outsideRoot, "outside.ts");
		fs.writeFileSync(outsideFile, "export const outside = true;\n");

		expect(resolveHookFiles(root, [outsideFile])).toEqual([]);
	});

	it("rejects an in-root symlink whose real file is outside the hook cwd", () => {
		const root = makeTempProject();
		const outsideRoot = makeTempProject();
		const outsideFile = path.join(outsideRoot, "outside.ts");
		const symlinkPath = path.join(root, "escaped.ts");
		fs.writeFileSync(outsideFile, "export const outside = true;\n");
		fs.symlinkSync(outsideFile, symlinkPath);

		expect(resolveHookFiles(root, [symlinkPath])).toEqual([]);
	});

	it("preserves valid relative and absolute files inside the hook cwd", () => {
		const root = makeTempProject();
		const relativePath = path.join("src", "inside.ts");
		const absolutePath = path.join(root, relativePath);
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
		fs.writeFileSync(absolutePath, "export const inside = true;\n");

		expect(resolveHookFiles(root, [relativePath])).toEqual([absolutePath]);
		expect(resolveHookFiles(root, [absolutePath])).toEqual([absolutePath]);
	});

	it("does not spawn subprocesses while collecting scan evidence", async () => {
		const root = makeTempProject();
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "project" }));
		fs.mkdirSync(path.join(root, "src"), { recursive: true });
		const sourcePath = path.join(root, "src/app.ts");
		fs.writeFileSync(sourcePath, "export const value = true;\n");

		await runScopedScan(root, [sourcePath]);

		expect(spawnSync).not.toHaveBeenCalled();
	});

	it("does not execute project-local Knip from automatic hook scans", async () => {
		const root = makeTempProject();
		const marker = path.join(root, "knip-executed.txt");
		const knipBin = path.join(root, "node_modules", "knip", "bin", "knip.js");

		fs.mkdirSync(path.dirname(knipBin), { recursive: true });
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "malicious" }));
		fs.mkdirSync(path.join(root, "src"), { recursive: true });
		fs.writeFileSync(path.join(root, "src", "touched.js"), "export const value = 1;\n");
		fs.writeFileSync(
			knipBin,
			`import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(marker)}, "executed");\nconsole.log("[]");\n`,
		);

		await runScopedScan(root, [path.join(root, "src", "touched.js")]);

		expect(fs.existsSync(marker)).toBe(false);
	});

	it("checks a changed test file for tautological assertions", async () => {
		const root = makeTempProject();
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "project" }));
		fs.mkdirSync(path.join(root, "src"), { recursive: true });
		fs.writeFileSync(path.join(root, "src", "app.ts"), "export const value = true;\n");
		const testPath = path.join(root, "src", "app.test.ts");
		fs.writeFileSync(testPath, "it('passes', () => expect(true).toBe(true));\n");

		const result = await runScopedScan(root, [testPath]);

		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				filePath: "src/app.test.ts",
				rule: "ai-slop/tautological-test",
			}),
		]);
	});

	it("uses unchanged ambient declarations during a scoped hook scan", async () => {
		const root = makeTempProject();
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "project" }));
		fs.mkdirSync(path.join(root, "src"), { recursive: true });
		fs.writeFileSync(path.join(root, "src/virtual.d.ts"), 'declare module "likec4:rpc";\n');
		const importer = path.join(root, "src/app.ts");
		fs.writeFileSync(importer, 'import { rpc } from "likec4:rpc";\nrpc();\n');

		const result = await runScopedScan(root, [importer]);

		expect(result.diagnostics).toEqual([]);
	});

	it("does not use excluded ambient declarations during a scoped hook scan", async () => {
		const root = makeTempProject();
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "project" }));
		fs.mkdirSync(path.join(root, ".aislop"), { recursive: true });
		fs.writeFileSync(
			path.join(root, ".aislop/config.yml"),
			["version: 1", "exclude:", "  - src/ignored.d.ts"].join("\n"),
		);
		fs.mkdirSync(path.join(root, "src"), { recursive: true });
		fs.writeFileSync(path.join(root, "src/ignored.d.ts"), 'declare module "ghost:ignored";\n');
		const importer = path.join(root, "src/app.ts");
		fs.writeFileSync(importer, 'import value from "ghost:ignored";\nvalue();\n');

		const result = await runScopedScan(root, [importer]);

		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				filePath: "src/app.ts",
				rule: "ai-slop/hallucinated-import",
			}),
		]);
	});

	it("respects configured include and exclude patterns for changed tests", async () => {
		const root = makeTempProject();
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "project" }));
		fs.mkdirSync(path.join(root, ".aislop"), { recursive: true });
		fs.writeFileSync(
			path.join(root, ".aislop/config.yml"),
			["version: 1", "include:", "  - src", "exclude:", "  - src/ignored.test.ts"].join("\n"),
		);
		fs.writeFileSync(path.join(root, ".aislopignore"), "src/also-ignored.test.ts\n");
		fs.mkdirSync(path.join(root, "src"), { recursive: true });
		const ignoredTest = path.join(root, "src/ignored.test.ts");
		const alsoIgnoredTest = path.join(root, "src/also-ignored.test.ts");
		const outsideInclude = path.join(root, "tests/outside.test.ts");
		fs.writeFileSync(ignoredTest, "expect(true).toBe(true);\n");
		fs.writeFileSync(alsoIgnoredTest, "expect(true).toBe(true);\n");
		fs.mkdirSync(path.dirname(outsideInclude), { recursive: true });
		fs.writeFileSync(outsideInclude, "expect(true).toBe(true);\n");

		const result = await runScopedScan(root, [ignoredTest, alsoIgnoredTest, outsideInclude]);

		expect(result.diagnostics).toEqual([]);
	});

	it("respects disabled rule overrides", async () => {
		const root = makeTempProject();
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "project" }));
		fs.mkdirSync(path.join(root, ".aislop"), { recursive: true });
		fs.writeFileSync(
			path.join(root, ".aislop/config.yml"),
			["version: 1", "rules:", "  ai-slop/tautological-test: off"].join("\n"),
		);
		fs.mkdirSync(path.join(root, "src"), { recursive: true });
		const testPath = path.join(root, "src/app.test.ts");
		fs.writeFileSync(testPath, "expect(true).toBe(true);\n");

		const result = await runScopedScan(root, [testPath]);

		expect(result.diagnostics).toEqual([]);
	});
});
