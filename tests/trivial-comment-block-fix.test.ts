import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixDeadPatterns } from "../src/engines/ai-slop/dead-patterns-fix.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const makeContext = (files: string[]): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["typescript"],
	frameworks: ["none"],
	files,
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 4, maxParams: 6 },
		security: { audit: true, auditTimeout: 25000 },
	},
});

const writeFile = (filename: string, content: string): string => {
	const filePath = path.join(tmpDir, filename);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
};

const readFile = (filename: string): string =>
	fs.readFileSync(path.join(tmpDir, filename), "utf-8");

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-trivial-block-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("fixDeadPatterns — multi-line `//` comment runs", () => {
	it("does not partially delete a 3-line consecutive `//` comment block", async () => {
		const original = [
			"export function run() {",
			"    // Load the config from disk",
			"    // then merge it with the defaults",
			"    // before validating the result",
			"    const config = build();",
			"    return config;",
			"}",
		].join("\n");
		const file = writeFile("block.ts", original);

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("block.ts");

		// Every line of the run is preserved — none deleted "at random".
		expect(result).toContain("// Load the config from disk");
		expect(result).toContain("// then merge it with the defaults");
		expect(result).toContain("// before validating the result");
		expect(result).toContain("const config = build();");
	});

	it("keeps an interior trivial-matching line inside a `//` run intact", async () => {
		const original = [
			"export function setup() {",
			"    // We keep this around for historical reasons",
			"    // Load defaults",
			"    // which the caller relies on downstream",
			"    return 1;",
			"}",
		].join("\n");
		const file = writeFile("interior.ts", original);

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("interior.ts");

		// "// Load defaults" matches a trivial pattern but is interior to the run.
		expect(result).toContain("// We keep this around for historical reasons");
		expect(result).toContain("// Load defaults");
		expect(result).toContain("// which the caller relies on downstream");
	});

	it("still removes a standalone single trivial `//` comment", async () => {
		const original = [
			"export function run() {",
			"    const value = 1;",
			"",
			"    // Return the value",
			"    return value;",
			"}",
		].join("\n");
		const file = writeFile("single.ts", original);

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("single.ts");

		expect(result).not.toContain("// Return the value");
		expect(result).toContain("return value;");
	});
});
