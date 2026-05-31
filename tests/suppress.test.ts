import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectBlocks, getCommentSyntax } from "../src/engines/ai-slop/comment-blocks.js";
import type { Diagnostic, EngineResult } from "../src/engines/types.js";
import { applySuppressions } from "../src/utils/suppress.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-suppress-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const write = (relativePath: string, content: string) => {
	const absolutePath = path.join(tmpDir, relativePath);
	fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
	fs.writeFileSync(absolutePath, content, "utf-8");
};

const diag = (filePath: string, line: number, rule: string): Diagnostic => ({
	filePath,
	engine: "ai-slop",
	rule,
	severity: "warning",
	message: "x",
	help: "",
	line,
	column: 1,
	category: "AI Slop",
	fixable: false,
});

const wrap = (diagnostics: Diagnostic[]): EngineResult[] => [
	{ engine: "ai-slop", diagnostics, elapsed: 0, skipped: false },
];

describe("applySuppressions", () => {
	it("suppresses the next line for a bare directive", () => {
		write("a.ts", "// aislop-ignore-next-line\nconst x = {} || {};\nconst y = 1;\n");
		const { results, suppressedCount } = applySuppressions(
			wrap([diag("a.ts", 2, "ai-slop/empty-fallback"), diag("a.ts", 3, "ai-slop/other")]),
			tmpDir,
		);
		expect(suppressedCount).toBe(1);
		expect(results[0].diagnostics.map((d) => d.line)).toEqual([3]);
	});

	it("only suppresses the named rule when one is given", () => {
		write("a.ts", "// aislop-ignore-next-line ai-slop/empty-fallback\nconst x = 1;\n");
		const { results, suppressedCount } = applySuppressions(
			wrap([diag("a.ts", 2, "ai-slop/empty-fallback"), diag("a.ts", 2, "ai-slop/other")]),
			tmpDir,
		);
		expect(suppressedCount).toBe(1);
		expect(results[0].diagnostics.map((d) => d.rule)).toEqual(["ai-slop/other"]);
	});

	it("matches a bare rule name against the engine-prefixed rule", () => {
		write("a.ts", "// aislop-ignore-next-line empty-fallback\nconst x = 1;\n");
		const { suppressedCount } = applySuppressions(
			wrap([diag("a.ts", 2, "ai-slop/empty-fallback")]),
			tmpDir,
		);
		expect(suppressedCount).toBe(1);
	});

	it("ignores a reason after the -- separator", () => {
		write(
			"a.ts",
			"// aislop-ignore-next-line ai-slop/empty-fallback -- intentional guard\nconst x = 1;\n",
		);
		const { suppressedCount } = applySuppressions(
			wrap([diag("a.ts", 2, "ai-slop/empty-fallback")]),
			tmpDir,
		);
		expect(suppressedCount).toBe(1);
	});

	it("suppresses on the same line via aislop-ignore-line", () => {
		write("a.ts", "const x = {} || {}; // aislop-ignore-line\n");
		const { suppressedCount } = applySuppressions(
			wrap([diag("a.ts", 1, "ai-slop/empty-fallback")]),
			tmpDir,
		);
		expect(suppressedCount).toBe(1);
	});

	it("suppresses a whole file with aislop-ignore-file", () => {
		write("a.ts", "// aislop-ignore-file ai-slop/empty-fallback\nconst a = 1;\nconst b = 2;\n");
		const { suppressedCount } = applySuppressions(
			wrap([
				diag("a.ts", 2, "ai-slop/empty-fallback"),
				diag("a.ts", 3, "ai-slop/empty-fallback"),
				diag("a.ts", 3, "ai-slop/other"),
			]),
			tmpDir,
		);
		expect(suppressedCount).toBe(2);
	});

	it("works with non-slash comment syntax (python hash)", () => {
		write("a.py", "# aislop-ignore-next-line\nx = 1\n");
		const { suppressedCount } = applySuppressions(
			wrap([diag("a.py", 2, "ai-slop/something")]),
			tmpDir,
		);
		expect(suppressedCount).toBe(1);
	});

	it("does not suppress unrelated lines and counts nothing when absent", () => {
		write("a.ts", "const x = 1;\nconst y = 2;\n");
		const { results, suppressedCount } = applySuppressions(
			wrap([diag("a.ts", 1, "ai-slop/other")]),
			tmpDir,
		);
		expect(suppressedCount).toBe(0);
		expect(results[0].diagnostics).toHaveLength(1);
	});

	it("ignores the directive words inside a string literal (no comment marker)", () => {
		write("a.ts", 'const help = "pass aislop-ignore-file to skip a file";\nconst y = 2;\n');
		const { suppressedCount } = applySuppressions(
			wrap([diag("a.ts", 1, "ai-slop/other"), diag("a.ts", 2, "ai-slop/other")]),
			tmpDir,
		);
		expect(suppressedCount).toBe(0);
	});
});

describe("aislop directive lines are invisible to comment blocks", () => {
	it("excludes a directive line so the comment below forms its own block", () => {
		const syntax = getCommentSyntax(".ts");
		if (!syntax) throw new Error("expected .ts comment syntax");
		const lines = [
			"// aislop-ignore-next-line ai-slop/narrative-comment",
			"// real comment line one",
			"// real comment line two",
			"export const x = 1;",
		];
		const blocks = collectBlocks(lines, syntax);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].startLine).toBe(2);
		expect(blocks[0].rawLines).toHaveLength(2);
	});
});
