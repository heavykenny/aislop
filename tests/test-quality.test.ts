import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiSlopEngine } from "../src/engines/ai-slop/index.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const buildContext = (languages: EngineContext["languages"]): EngineContext => ({
	rootDirectory: tmpDir,
	languages,
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-test-quality-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("tautological test assertions", () => {
	it("flags a JavaScript assertion that can never fail", async () => {
		writeFile(
			"src/value.test.ts",
			[
				"it('passes', () => { expect(true).toBe(true); });",
				"it('also passes', () => { assert.strictEqual(1, 1); });",
			].join("\n"),
		);

		const result = await aiSlopEngine.run(buildContext(["typescript"]));

		expect(result.diagnostics.filter((d) => d.rule === "ai-slop/tautological-test")).toEqual([
			expect.objectContaining({ filePath: "src/value.test.ts", line: 1 }),
			expect.objectContaining({ filePath: "src/value.test.ts", line: 2 }),
		]);
	});

	it("flags a Python assertion that can never fail", async () => {
		writeFile(
			"tests/test_pipeline.py",
			"def test_pipeline():\n    run_pipeline()\n    assert True\n",
		);

		const result = await aiSlopEngine.run(buildContext(["python"]));

		expect(result.diagnostics.filter((d) => d.rule === "ai-slop/tautological-test")).toEqual([
			expect.objectContaining({ filePath: "tests/test_pipeline.py", line: 3 }),
		]);
	});

	it("does not flag assertion examples inside comments or strings", async () => {
		writeFile(
			"src/checker.test.ts",
			[
				"// expect(true).toBe(true)",
				"const sample = `expect(true).toBe(true);`;",
				"it('checks output', () => expect(run()).toBe(true));",
				"it('compares outcomes', () => expect(1).toBe(2));",
			].join("\n"),
		);

		const result = await aiSlopEngine.run(buildContext(["typescript"]));

		expect(result.diagnostics.filter((d) => d.rule === "ai-slop/tautological-test")).toEqual([]);
	});
});
