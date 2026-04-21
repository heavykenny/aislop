import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDuplicateBlocks } from "../../src/engines/code-quality/duplicate-block.js";
import type { EngineContext } from "../../src/engines/types.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-dup-"));
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

describe("duplicate-block", () => {
	it("flags a 10-line block that appears twice in the same file", async () => {
		write(
			"a.ts",
			`export const runA = async (dir: string) => {
	const config = loadConfig(dir);
	const result = await scanCommand(dir, config, opts);
	if (result.exitCode !== 0) {
		await flushTelemetry();
		process.exit(result.exitCode);
	}
	const report = await buildReport(result, dir);
	await writeReport(report, "a");
	await report({ status: "done" });
	return result;
};

export const runB = async (dir: string) => {
	const config = loadConfig(dir);
	const result = await scanCommand(dir, config, opts);
	if (result.exitCode !== 0) {
		await flushTelemetry();
		process.exit(result.exitCode);
	}
	const report = await buildReport(result, dir);
	await writeReport(report, "b");
	await report({ status: "done" });
	return result;
};
`,
		);
		const diags = await detectDuplicateBlocks(ctx(tmpDir));
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].rule).toBe("code-quality/duplicate-block");
		expect(diags[0].message).toMatch(/duplicates a block/);
	});

	it("does not flag a single non-duplicated block", async () => {
		write(
			"b.ts",
			`export const only = (dir: string) => {
	const config = loadConfig(dir);
	const result = scanCommand(dir, config);
	if (result.exitCode !== 0) {
		flushTelemetry();
		process.exit(1);
	}
};
`,
		);
		const diags = await detectDuplicateBlocks(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("does not flag structurally similar but identifier-distinct blocks (keeps noise low)", async () => {
		write(
			"c.ts",
			`const one = fetch(urlA);
one.then(handleA);
one.catch(errorA);
one.finally(cleanupA);
one.abort();

const two = fetch(urlB);
two.then(handleB);
two.catch(errorB);
two.finally(cleanupB);
two.abort();
`,
		);
		const diags = await detectDuplicateBlocks(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("does not flag purely boilerplate trivial lines like closing braces", async () => {
		write(
			"d.ts",
			`export const one = () => {
};

export const two = () => {
};

export const three = () => {
};
`,
		);
		const diags = await detectDuplicateBlocks(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});
});
