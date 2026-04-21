import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkComplexity } from "../src/engines/code-quality/complexity.js";
import type { EngineContext } from "../src/engines/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

const makeContext = (
	files: string[],
	qualityOverrides: Partial<EngineContext["config"]["quality"]> = {},
): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["typescript"],
	frameworks: ["none"],
	files,
	installedTools: {},
	config: {
		quality: {
			maxFunctionLoc: 80,
			maxFileLoc: 400,
			maxNesting: 4,
			maxParams: 6,
			...qualityOverrides,
		},
		security: { audit: true, auditTimeout: 25000 },
	},
});

const writeFile = (filename: string, content: string): string => {
	const filePath = path.join(tmpDir, filename);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
};

const makeLines = (count: number, line = "  const x = 1;"): string =>
	Array(count).fill(line).join("\n");

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-complexity-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── checkComplexity ──────────────────────────────────────────────────────────

describe("checkComplexity — file too large", () => {
	it("returns no file-too-large diagnostic when file is within limit", async () => {
		const content = makeLines(50, "const x = 1;");
		const filePath = writeFile("small.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath]));
		const fileDiags = diagnostics.filter((d) => d.rule === "complexity/file-too-large");
		expect(fileDiags).toHaveLength(0);
	});

	it("returns a file-too-large diagnostic when file exceeds maxFileLoc", async () => {
		// maxFileLoc = 10, write a 15-line file
		const content = makeLines(15, "const x = 1;");
		const filePath = writeFile("big.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFileLoc: 10 }));
		const fileDiags = diagnostics.filter((d) => d.rule === "complexity/file-too-large");
		expect(fileDiags).toHaveLength(1);
		expect(fileDiags[0].severity).toBe("warning");
		expect(fileDiags[0].engine).toBe("code-quality");
		expect(fileDiags[0].message).toContain("15");
		expect(fileDiags[0].message).toContain("10");
	});

	it("includes the file path in the diagnostic", async () => {
		const content = makeLines(15, "const x = 1;");
		const filePath = writeFile("subdir/big.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFileLoc: 10 }));
		const fileDiags = diagnostics.filter((d) => d.rule === "complexity/file-too-large");
		expect(fileDiags).toHaveLength(1);
		expect(path.isAbsolute(fileDiags[0].filePath)).toBe(false);
		expect(fileDiags[0].filePath).toContain("big.ts");
	});

	it("returns no diagnostic when file is exactly at maxFileLoc", async () => {
		const content = makeLines(10, "const x = 1;");
		const filePath = writeFile("exact.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFileLoc: 10 }));
		const fileDiags = diagnostics.filter((d) => d.rule === "complexity/file-too-large");
		expect(fileDiags).toHaveLength(0);
	});

	it("applies a 1.5x tolerance to .tsx files", async () => {
		// maxFileLoc = 10, effective TSX cap = 15. 15 lines passes; 16 fires.
		const fifteen = writeFile("page.tsx", makeLines(15, "const x = 1;"));
		const sixteen = writeFile("too-big.tsx", makeLines(16, "const x = 1;"));
		const diagnostics = await checkComplexity(makeContext([fifteen, sixteen], { maxFileLoc: 10 }));
		const fileDiags = diagnostics
			.filter((d) => d.rule === "complexity/file-too-large")
			.map((d) => d.filePath);
		expect(fileDiags).toHaveLength(1);
		expect(fileDiags[0]).toContain("too-big.tsx");
	});

	it("applies the same 1.5x tolerance to .jsx files", async () => {
		const filePath = writeFile("widget.jsx", makeLines(16, "const x = 1;"));
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFileLoc: 10 }));
		const fileDiags = diagnostics.filter((d) => d.rule === "complexity/file-too-large");
		expect(fileDiags).toHaveLength(1);
		expect(fileDiags[0].message).toContain("max: 15");
	});

	it("does NOT apply the JSX tolerance to .ts files", async () => {
		// 11 lines on .ts at max 10 must fire (no multiplier, no soft buffer).
		const filePath = writeFile("logic.ts", makeLines(11, "const x = 1;"));
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFileLoc: 10 }));
		const fileDiags = diagnostics.filter((d) => d.rule === "complexity/file-too-large");
		expect(fileDiags).toHaveLength(1);
	});
});

describe("checkComplexity — function too long", () => {
	it("returns no function-too-long diagnostic for a short function", async () => {
		const content = ["function shortFn(a: number) {", "  return a + 1;", "}"].join("\n");
		const filePath = writeFile("short.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 80 }));
		const fnDiags = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		expect(fnDiags).toHaveLength(0);
	});

	it("detects a function that exceeds maxFunctionLoc", async () => {
		// Write a function with 10 lines body, set maxFunctionLoc to 5
		const body = Array(8).fill("  const x = 1;").join("\n");
		const content = `function longFn(a: number) {\n${body}\n  return a;\n}`;
		const filePath = writeFile("long.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 5 }));
		const fnDiags = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		expect(fnDiags.length).toBeGreaterThanOrEqual(1);
		expect(fnDiags[0].severity).toBe("warning");
		expect(fnDiags[0].engine).toBe("code-quality");
		expect(fnDiags[0].message).toContain("longFn");
		expect(fnDiags[0].message).toContain("5");
	});

	it("reports the start line of the function", async () => {
		const content = [
			"const a = 1;",
			"const b = 2;",
			"function myFunc(x: number) {",
			"  const c = x;",
			"  const d = c * 2;",
			"  return d;",
			"}",
		].join("\n");
		const filePath = writeFile("lines.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 2 }));
		const fnDiags = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		expect(fnDiags.length).toBeGreaterThanOrEqual(1);
		// Function starts on line 3
		expect(fnDiags[0].line).toBe(3);
	});

	it("detects async functions", async () => {
		const body = Array(8).fill("  await sleep(1);").join("\n");
		const content = `async function asyncFn(): Promise<void> {\n${body}\n}`;
		const filePath = writeFile("async.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 5 }));
		const fnDiags = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		expect(fnDiags.length).toBeGreaterThanOrEqual(1);
		expect(fnDiags[0].message).toContain("asyncFn");
	});

	it("does not flag a function dominated by a single template literal (e.g. llms.txt.ts GET)", async () => {
		const templateLines = Array(100).fill("some template line").join("\n");
		const content = [
			"export const GET = async () => {",
			"  const body = `",
			templateLines,
			"  `;",
			"  return new Response(body);",
			"};",
		].join("\n");
		const filePath = writeFile("llms.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 80 }));
		const fnDiags = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		expect(fnDiags).toHaveLength(0);
	});

	it("still flags a function with real logic even if it contains a small template literal", async () => {
		const logic = Array(90).fill("  const x = 1;").join("\n");
		const content = [
			"function realLogic() {",
			"  const tag = `tag-${id}`;",
			logic,
			"  return tag;",
			"}",
		].join("\n");
		const filePath = writeFile("logic.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 80 }));
		const fnDiags = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		expect(fnDiags.length).toBeGreaterThanOrEqual(1);
	});
});

describe("checkComplexity — too many parameters", () => {
	it("returns no too-many-params diagnostic for acceptable parameter count", async () => {
		const content = "function fn(a: string, b: number) { return a; }";
		const filePath = writeFile("ok-params.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxParams: 6 }));
		const paramDiags = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(paramDiags).toHaveLength(0);
	});

	it("detects a function with too many parameters", async () => {
		const content =
			"function manyParams(a: string, b: number, c: boolean, d: string, e: number) { return a; }";
		const filePath = writeFile("many-params.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxParams: 3 }));
		const paramDiags = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(paramDiags.length).toBeGreaterThanOrEqual(1);
		expect(paramDiags[0].severity).toBe("warning");
		expect(paramDiags[0].message).toContain("manyParams");
		expect(paramDiags[0].message).toContain("3");
	});

	it("counts parameters correctly for 0-param functions", async () => {
		const content = "function noParams() { return 1; }";
		const filePath = writeFile("no-params.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxParams: 1 }));
		const paramDiags = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(paramDiags).toHaveLength(0);
	});

	it("detects Python functions with too many parameters", async () => {
		const content = "def complex_func(a, b, c, d, e, f, g):\n    return a + b\n";
		const filePath = writeFile("params.py", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxParams: 4 }));
		const paramDiags = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(paramDiags.length).toBeGreaterThanOrEqual(1);
		expect(paramDiags[0].message).toContain("complex_func");
	});
});

describe("checkComplexity — deep nesting", () => {
	it("returns no deep-nesting diagnostic for shallow code", async () => {
		const content = [
			"function shallow(x: number) {",
			"  if (x > 0) {",
			"    return x;",
			"  }",
			"  return 0;",
			"}",
		].join("\n");
		const filePath = writeFile("shallow.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxNesting: 10 }));
		const nestDiags = diagnostics.filter((d) => d.rule === "complexity/deep-nesting");
		expect(nestDiags).toHaveLength(0);
	});

	it("detects deeply nested code", async () => {
		// 10-level deep indentation (20 spaces = 10 levels at 2-space indent)
		const content = [
			"function deepNest(x: number) {",
			"  if (x) {",
			"    if (x) {",
			"      if (x) {",
			"        if (x) {",
			"          if (x) {",
			"                    const deep = true;",
			"          }",
			"        }",
			"      }",
			"    }",
			"  }",
			"}",
		].join("\n");
		const filePath = writeFile("deep.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxNesting: 2 }));
		const nestDiags = diagnostics.filter((d) => d.rule === "complexity/deep-nesting");
		expect(nestDiags.length).toBeGreaterThanOrEqual(1);
		expect(nestDiags[0].severity).toBe("warning");
		expect(nestDiags[0].message).toContain("deepNest");
	});
});

describe("checkComplexity — general", () => {
	it("returns empty array when files list is empty", async () => {
		const diagnostics = await checkComplexity(makeContext([]));
		expect(diagnostics).toHaveLength(0);
	});

	it("returns empty array for an empty file", async () => {
		const filePath = writeFile("empty.ts", "");
		const diagnostics = await checkComplexity(makeContext([filePath]));
		expect(diagnostics).toHaveLength(0);
	});

	it("skips non-source files", async () => {
		const filePath = writeFile("README.md", makeLines(500, "some text"));
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFileLoc: 10 }));
		expect(diagnostics).toHaveLength(0);
	});

	it("can emit multiple distinct violation types in the same file", async () => {
		// File: over line limit, has a long function, and too many params
		const body = Array(15).fill("  const x = y;").join("\n");
		const content = [
			`function overloaded(a: string, b: number, c: boolean, d: string, e: number, f: object, g: null) {`,
			body,
			`  return a;`,
			`}`,
		].join("\n");
		const filePath = writeFile("overloaded.ts", content);
		const diagnostics = await checkComplexity(
			makeContext([filePath], {
				maxFunctionLoc: 5,
				maxFileLoc: 10,
				maxParams: 3,
			}),
		);
		const rules = new Set(diagnostics.map((d) => d.rule));
		expect(rules.has("complexity/function-too-long")).toBe(true);
		expect(rules.has("complexity/too-many-params")).toBe(true);
		expect(rules.has("complexity/file-too-large")).toBe(true);
	});

	it("all diagnostics have engine code-quality", async () => {
		const body = Array(8).fill("  const x = 1;").join("\n");
		const content = `function fn(a: string) {\n${body}\n}`;
		const filePath = writeFile("engine.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 5 }));
		for (const d of diagnostics) {
			expect(d.engine).toBe("code-quality");
		}
	});

	it("all diagnostics have category Complexity", async () => {
		const body = Array(8).fill("  const x = 1;").join("\n");
		const content = `function fn(a: string) {\n${body}\n}`;
		const filePath = writeFile("cat.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 5 }));
		for (const d of diagnostics) {
			expect(d.category).toBe("Complexity");
		}
	});

	it("all diagnostics are marked as not fixable", async () => {
		const body = Array(8).fill("  const x = 1;").join("\n");
		const content = `function fn(a: string) {\n${body}\n}`;
		const filePath = writeFile("notfix.ts", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 5 }));
		for (const d of diagnostics) {
			expect(d.fixable).toBe(false);
		}
	});

	it("detects Go functions", async () => {
		const body = Array(8).fill("  x := 1").join("\n");
		const content = `package main\n\nfunc processData(a string) string {\n${body}\n  return a\n}`;
		const filePath = writeFile("main.go", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 5 }));
		const fnDiags = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		expect(fnDiags.length).toBeGreaterThanOrEqual(1);
		expect(fnDiags[0].message).toContain("processData");
	});
});
