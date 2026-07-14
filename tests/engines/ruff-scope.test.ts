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

const writeFakeRuff = (rootDirectory: string): string => {
	const binDir = path.join(rootDirectory, "bin");
	const ruffPath = path.join(binDir, "ruff");
	fs.mkdirSync(binDir, { recursive: true });
	fs.writeFileSync(
		ruffPath,
		`#!/usr/bin/env node
const path = require("node:path");
const targets = process.argv.slice(2).filter((arg) => !arg.startsWith("-") && arg !== "check");
const diagnostics = targets
  .filter((target) => path.basename(target) === "bad.py")
  .map((target) => ({
    code: "F401",
    message: "\`definitely_unused\` imported but unused",
    filename: target,
    location: { row: 1, column: 8 },
    fix: { applicability: "safe" }
  }));
process.stdout.write(JSON.stringify(diagnostics));
process.exit(diagnostics.length > 0 ? 1 : 0);
`,
		"utf-8",
	);
	fs.chmodSync(ruffPath, 0o755);
	return ruffPath;
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

// The fake ruff is a POSIX shebang shim. Node refuses to spawn script shims (.cmd/.bat or
// extension-less shebang files) without a shell on Windows (EINVAL), and runSubprocess spawns
// shell-lessly by design. Ruff scoping logic is OS-independent and is covered on POSIX CI.
describe.skipIf(process.platform === "win32")("ruff scope", () => {
	let tmpDir: string;
	let fakeRuffPath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ruff-scope-"));
		fakeRuffPath = writeFakeRuff(tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("only lints the filtered source files selected by aislop", async () => {
		writeFile(tmpDir, "src/app.py", "def hello():\n    return 1\n");
		writeFile(tmpDir, "code_samples/bad.py", "import definitely_unused\n");

		const diagnostics = await runRuffLint(
			buildContext(tmpDir, getSourceFilesForRoot(tmpDir)),
			fakeRuffPath,
		);

		expect(diagnostics).toEqual([]);
	});

	it("still lints an explicitly provided Python file", async () => {
		const badFile = writeFile(tmpDir, "code_samples/bad.py", "import definitely_unused\n");

		const diagnostics = await runRuffLint(buildContext(tmpDir, [badFile]), fakeRuffPath);

		expect(diagnostics.some((diagnostic) => diagnostic.rule === "ruff/F401")).toBe(true);
	});
});
