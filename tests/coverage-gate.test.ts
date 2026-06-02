import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { coverageReason } from "../src/commands/scan-coverage.js";
import { discoverProject } from "../src/utils/discover.js";

let tmpDir: string;

const write = (rel: string, content: string) => {
	const p = path.join(tmpDir, rel);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, content, "utf-8");
};

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-coverage-"));
	execFileSync("git", ["init"], { cwd: tmpDir, stdio: "ignore" });
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("coverage gate (discoverProject)", () => {
	it("withholds the score for a repo dominated by an unsupported language", async () => {
		for (let i = 0; i < 15; i++) write(`f${i}.c`, "int main(){return 0;}\n");
		write("util.py", "def add(a, b):\n    return a + b\n");

		const info = await discoverProject(tmpDir);
		expect(info.coverage.scoreable).toBe(false);
		expect(info.coverage.dominantUnsupported).toBe("C/C++");
		expect(info.coverage.unsupportedFiles).toBe(15);
	});

	it("scores a normal supported-language repo", async () => {
		for (let i = 0; i < 5; i++) write(`src/m${i}.ts`, `export const v${i} = ${i};\n`);

		const info = await discoverProject(tmpDir);
		expect(info.coverage.scoreable).toBe(true);
		expect(info.coverage.unsupportedFiles).toBe(0);
	});

	it("still scores a supported repo with a minority of unsupported files", async () => {
		for (let i = 0; i < 30; i++) write(`m${i}.py`, `def f${i}():\n    return ${i}\n`);
		for (let i = 0; i < 5; i++) write(`ext${i}.c`, "int x;\n");

		const info = await discoverProject(tmpDir);
		expect(info.coverage.scoreable).toBe(true);
	});

	it("does not count an excluded subtree (vendor/) toward unsupported coverage", async () => {
		for (let i = 0; i < 5; i++) write(`src/m${i}.ts`, `export const v${i} = ${i};\n`);
		for (let i = 0; i < 50; i++) write(`vendor/lib/c${i}.c`, "int x;\n");

		const info = await discoverProject(tmpDir);
		expect(info.coverage.unsupportedFiles).toBe(0);
		expect(info.coverage.scoreable).toBe(true);
	});

	it("honors user exclude patterns so an ignored unsupported tree does not withhold the score", async () => {
		for (let i = 0; i < 5; i++) write(`src/m${i}.ts`, `export const v${i} = ${i};\n`);
		for (let i = 0; i < 50; i++) write(`legacy/c${i}.c`, "int x;\n");

		// Without the exclude the C tree dominates and the score is withheld.
		const withoutExclude = await discoverProject(tmpDir);
		expect(withoutExclude.coverage.scoreable).toBe(false);

		// With the same exclude the scan applies, the C tree is ignored and the TS is scored.
		const withExclude = await discoverProject(tmpDir, ["legacy"]);
		expect(withExclude.coverage.unsupportedFiles).toBe(0);
		expect(withExclude.coverage.scoreable).toBe(true);
	});

	it("counts supported files post-exclude, so excluding supported code can still withhold the score", async () => {
		write("src/main.ts", "export const x = 1;\n");
		for (let i = 0; i < 50; i++) write(`c${i}.c`, "int x;\n");
		for (let i = 0; i < 30; i++) write(`legacy/old${i}.ts`, `export const y${i} = ${i};\n`);

		// Excluding the legacy TS tree leaves 1 scanned TS file against 50 C files → withheld.
		const info = await discoverProject(tmpDir, ["legacy"]);
		expect(info.coverage.supportedFiles).toBe(1);
		expect(info.coverage.scoreable).toBe(false);
	});

	it("withholds when there are no supported files to analyze", async () => {
		write("README.md", "# docs only\n");
		write("notes.md", "nothing to score\n");

		const info = await discoverProject(tmpDir);
		expect(info.coverage.supportedFiles).toBe(0);
		expect(info.coverage.scoreable).toBe(false);
	});
});

describe("coverageReason", () => {
	it("names the dominant language when nothing supported was found", () => {
		const msg = coverageReason({
			supportedFiles: 0,
			unsupportedFiles: 6000,
			dominantUnsupported: "C/C++",
			scoreable: false,
		});
		expect(msg).toContain("C/C++");
		expect(msg).toContain("does not analyze");
	});

	it("explains the sliver case when a few supported files exist", () => {
		const msg = coverageReason({
			supportedFiles: 2,
			unsupportedFiles: 6000,
			dominantUnsupported: "C/C++",
			scoreable: false,
		});
		expect(msg).toContain("only 2 supported files");
		expect(msg).toContain("Score withheld");
	});

	it("falls back to a generic message with no code at all", () => {
		const msg = coverageReason({
			supportedFiles: 0,
			unsupportedFiles: 0,
			dominantUnsupported: null,
			scoreable: false,
		});
		expect(msg).toContain("Nothing to score");
	});
});
