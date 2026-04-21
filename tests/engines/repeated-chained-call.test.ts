import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectRepeatedChainedCalls } from "../../src/engines/code-quality/repeated-chained-call.js";
import type { EngineContext } from "../../src/engines/types.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-rcc-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ctx = (rootDirectory: string): EngineContext => ({
	rootDirectory,
	languages: ["typescript"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: true, auditTimeout: 25000 },
	},
});

const write = (relative: string, content: string): void => {
	const full = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
};

describe("repeated-chained-call", () => {
	it("flags a chain of 5+ adjacent .option() calls differing only in string literals", async () => {
		write(
			"a.ts",
			`const program = new Command();
program
	.option("--one", "first")
	.option("--two", "second")
	.option("--three", "third")
	.option("--four", "fourth")
	.option("--five", "fifth")
	.action(() => {});
`,
		);
		const diags = await detectRepeatedChainedCalls(ctx(tmpDir));
		expect(diags).toHaveLength(1);
		expect(diags[0].rule).toBe("code-quality/repeated-chained-call");
		expect(diags[0].message).toMatch(/5 consecutive `\.option\(\)`/);
	});

	it("does not flag 4 consecutive calls (below threshold)", async () => {
		write(
			"b.ts",
			`program
	.option("--one", "1")
	.option("--two", "2")
	.option("--three", "3")
	.option("--four", "4");
`,
		);
		const diags = await detectRepeatedChainedCalls(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("does not flag 5 calls with structural differences beyond string literals", async () => {
		write(
			"c.ts",
			`program
	.option("--one", "1", defaultValueForOne)
	.option("--two", "2")
	.option("--three", "3")
	.option("--four", "4")
	.option("--five", "5");
`,
		);
		const diags = await detectRepeatedChainedCalls(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("does not flag a chain of different method names", async () => {
		write(
			"d.ts",
			`program
	.option("--one", "1")
	.description("d")
	.option("--two", "2")
	.action(() => {})
	.option("--three", "3");
`,
		);
		const diags = await detectRepeatedChainedCalls(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("flags two separate chains in the same file independently", async () => {
		write(
			"e.ts",
			`groupOne
	.add("a")
	.add("b")
	.add("c")
	.add("d")
	.add("e");

groupTwo
	.push("one")
	.push("two")
	.push("three")
	.push("four")
	.push("five");
`,
		);
		const diags = await detectRepeatedChainedCalls(ctx(tmpDir));
		expect(diags).toHaveLength(2);
		expect(diags[0].message).toMatch(/\.add\(\)/);
		expect(diags[1].message).toMatch(/\.push\(\)/);
	});
});
