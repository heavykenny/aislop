import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { runRuffLint } from "../../src/engines/lint/ruff.js";
import type { EngineContext } from "../../src/engines/types.js";
import { getSourceFilesForRoot } from "../../src/utils/source-files.js";

const writeFile = (rootDirectory: string, filePath: string, content: string): string => {
	const absolutePath = path.join(rootDirectory, filePath);
	fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
	fs.writeFileSync(absolutePath, content, "utf-8");
	return absolutePath;
};

const buildContext = (rootDirectory: string, files?: string[]): EngineContext => ({
	rootDirectory,
	languages: ["python"],
	frameworks: [],
	files,
	installedTools: { ruff: true },
	config: {
		quality: DEFAULT_CONFIG.quality,
		security: DEFAULT_CONFIG.security,
		lint: DEFAULT_CONFIG.lint,
	},
});

describe("ruff scope", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ruff-scope-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("only lints the filtered source files selected by aislop", async () => {
		writeFile(tmpDir, "src/app.py", "def hello():\n    return 1\n");
		writeFile(tmpDir, "code_samples/bad.py", "import definitely_unused\n");

		const diagnostics = await runRuffLint(buildContext(tmpDir, getSourceFilesForRoot(tmpDir)));

		expect(diagnostics).toEqual([]);
	});

	it("still lints an explicitly provided Python file", async () => {
		const badFile = writeFile(tmpDir, "code_samples/bad.py", "import definitely_unused\n");

		const diagnostics = await runRuffLint(buildContext(tmpDir, [badFile]));

		expect(diagnostics.some((diagnostic) => diagnostic.rule === "ruff/F401")).toBe(true);
	});
});
