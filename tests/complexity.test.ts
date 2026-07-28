import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeFunctions, checkComplexity } from "../src/engines/code-quality/complexity.js";
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
		expect(fileDiags[0].detail).toContain("15");
		expect(fileDiags[0].message).toContain("10");
	});

	it("points C# files at partial classes in the file-too-large help", async () => {
		const content = makeLines(15, "// filler");
		const filePath = writeFile("Big.cs", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFileLoc: 10 }));
		const fileDiags = diagnostics.filter((d) => d.rule === "complexity/file-too-large");
		expect(fileDiags).toHaveLength(1);
		expect(fileDiags[0].help).toContain("partial class");
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

	it("applies a 1.5x JSX tolerance plus a 10% buffer to .tsx files", async () => {
		// maxFileLoc = 10 → TSX cap 15 → trigger at 17 (10% buffer). 17 passes; 18 fires.
		const seventeen = writeFile("page.tsx", makeLines(17, "const x = 1;"));
		const eighteen = writeFile("too-big.tsx", makeLines(18, "const x = 1;"));
		const diagnostics = await checkComplexity(
			makeContext([seventeen, eighteen], { maxFileLoc: 10 }),
		);
		const fileDiags = diagnostics
			.filter((d) => d.rule === "complexity/file-too-large")
			.map((d) => d.filePath);
		expect(fileDiags).toHaveLength(1);
		expect(fileDiags[0]).toContain("too-big.tsx");
	});

	it("applies the same JSX-plus-buffer tolerance to .jsx files", async () => {
		const filePath = writeFile("widget.jsx", makeLines(18, "const x = 1;"));
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFileLoc: 10 }));
		const fileDiags = diagnostics.filter((d) => d.rule === "complexity/file-too-large");
		expect(fileDiags).toHaveLength(1);
		expect(fileDiags[0].message).toContain("max: 15");
	});

	it("applies a 10% buffer over maxFileLoc to .ts files (no JSX multiplier)", async () => {
		// maxFileLoc = 10 → trigger at 11 (10% buffer). 11 passes; 12 fires.
		const eleven = writeFile("ok.ts", makeLines(11, "const x = 1;"));
		const twelve = writeFile("logic.ts", makeLines(12, "const x = 1;"));
		const diagnostics = await checkComplexity(makeContext([eleven, twelve], { maxFileLoc: 10 }));
		const fileDiags = diagnostics
			.filter((d) => d.rule === "complexity/file-too-large")
			.map((d) => d.filePath);
		expect(fileDiags).toHaveLength(1);
		expect(fileDiags[0]).toContain("logic.ts");
	});

	it("gives C/C++ files a 2.5x file budget (same as Rust)", async () => {
		// maxFileLoc = 10 → C++ budget 25, trigger at ceil(25 * 1.1) = 28.
		const within = writeFile("ok.cpp", makeLines(28, "int x = 1;"));
		const over = writeFile("big.cpp", makeLines(29, "int x = 1;"));
		const diagnostics = await checkComplexity(makeContext([within, over], { maxFileLoc: 10 }));
		const fileDiags = diagnostics.filter((d) => d.rule === "complexity/file-too-large");
		expect(fileDiags).toHaveLength(1);
		expect(fileDiags[0].filePath).toContain("big.cpp");
		expect(fileDiags[0].message).toContain("max: 25");
	});

	it("points oversized C++ files at the component-as-translation-unit pattern", async () => {
		const filePath = writeFile("mft.cpp", makeLines(30, "int x = 1;"));
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFileLoc: 10 }));
		const fileDiags = diagnostics.filter((d) => d.rule === "complexity/file-too-large");
		expect(fileDiags).toHaveLength(1);
		expect(fileDiags[0].help).toContain("component-as-translation-unit pattern");
		expect(fileDiags[0].help).toContain("docs/cpp-component-pattern.md");
	});

	it("applies the C++ component hint to ambiguous .h headers in a C++ tree", async () => {
		const header = writeFile("mft.h", makeLines(30, "int x = 1;"));
		const diagnostics = await checkComplexity(makeContext([header], { maxFileLoc: 10 }));
		const fileDiags = diagnostics.filter((d) => d.rule === "complexity/file-too-large");
		expect(fileDiags).toHaveLength(1);
		expect(fileDiags[0].help).toContain("component-as-translation-unit pattern");
	});

	it("keeps the generic split hint for non-C++ files", async () => {
		const filePath = writeFile("logic.ts", makeLines(15, "const x = 1;"));
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFileLoc: 10 }));
		const fileDiags = diagnostics.filter((d) => d.rule === "complexity/file-too-large");
		expect(fileDiags).toHaveLength(1);
		expect(fileDiags[0].help).toBe("Consider splitting this file into smaller modules");
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
		expect(fnDiags[0].detail).toContain("longFn");
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
		expect(fnDiags[0].detail).toContain("asyncFn");
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

describe("analyzeFunctions: braces inside strings/comments don't skew length", () => {
	it("does not count a brace inside a line comment as opening a block", () => {
		const content = [
			"function tiny(a: number) {",
			"  // a single-statement loop body `for (...)` with no `{`",
			"  return a + 1;",
			"}",
			"function after() {",
			"  return 2;",
			"}",
		].join("\n");
		const tiny = analyzeFunctions(content, ".ts").find((f) => f.name === "tiny");
		expect(tiny?.lineCount).toBe(4);
	});

	it("does not count a brace inside a string literal", () => {
		const content = [
			"function parses(line: string) {",
			'  if (!line.startsWith("{")) return null;',
			"  return JSON.parse(line);",
			"}",
			"function after() {",
			"  return 2;",
			"}",
		].join("\n");
		const parses = analyzeFunctions(content, ".ts").find((f) => f.name === "parses");
		expect(parses?.lineCount).toBe(4);
	});

	it("does not count a brace inside a block comment", () => {
		const content = [
			"function blocky() {",
			"  /* shape: { a, b } but unbalanced { here */",
			"  return 1;",
			"}",
			"function after() {",
			"  return 2;",
			"}",
		].join("\n");
		const blocky = analyzeFunctions(content, ".ts").find((f) => f.name === "blocky");
		expect(blocky?.lineCount).toBe(4);
	});
});

describe("analyzeFunctions: Python end-detection uses masked lines", () => {
	it("does not truncate a Python function at a comment dedented to column 0", () => {
		const content = [
			"def f():",
			"    x = 1",
			"# dedented comment",
			"    y = 2",
			"    return x + y",
		].join("\n");
		const fn = analyzeFunctions(content, ".py").find((f) => f.name === "f");
		expect(fn?.lineCount).toBe(5);
	});

	it("does not truncate a Python function at a triple-quoted string line dedented to column 0", () => {
		const content = [
			"def g():",
			'    text = """',
			"some content at column 0",
			'    """',
			"    return text",
		].join("\n");
		const fn = analyzeFunctions(content, ".py").find((f) => f.name === "g");
		expect(fn?.lineCount).toBe(5);
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
		expect(paramDiags[0].detail).toContain("manyParams");
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
		expect(paramDiags[0].detail).toContain("complex_func");
	});

	it("counts only required params, ignoring self, defaults, and *args/**kwargs", async () => {
		const content =
			"def send(self, chat_id, text, *args, parse_mode=None, reply=None, **kwargs):\n    return chat_id\n";
		const filePath = writeFile("api_method.py", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxParams: 3 }));
		const paramDiags = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(paramDiags).toHaveLength(0);
	});

	it("flags a function with many required params even when wrapped", async () => {
		const content = "def f(\n    a,\n    b,\n    c,\n    d,\n    e,\n):\n    return a\n";
		const filePath = writeFile("many_required.py", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxParams: 3 }));
		const paramDiags = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(paramDiags.length).toBeGreaterThanOrEqual(1);
		expect(paramDiags[0].detail).toContain("f");
	});

	it("does not count commas inside C# generic type arguments as parameter separators", async () => {
		// Five real parameters whose types each carry an internal comma; a naive
		// split(",") misreports this as nine and fires a false positive.
		const content =
			"class C {\n" +
			"    public C(\n" +
			"        IReadOnlyList<Record> records,\n" +
			"        IReadOnlyDictionary<string, Cursor> armed,\n" +
			"        IReadOnlyDictionary<string, Cursor> advanced,\n" +
			"        IReadOnlyDictionary<string, Entry[]> catchUp,\n" +
			"        IReadOnlyDictionary<string, string> errors)\n" +
			"    {\n" +
			"        _r = records;\n" +
			"    }\n" +
			"}\n";
		const filePath = writeFile("Generics.cs", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxParams: 6 }));
		const paramDiags = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(paramDiags).toHaveLength(0);
	});

	it("does not count commas inside C# Func and tuple parameter types", async () => {
		// Four real Func-typed parameters loaded with generic and tuple commas.
		const content =
			"class Host {\n" +
			"    public Host(\n" +
			"        Func<string, Cursor> queryCursor,\n" +
			"        Func<string, Record[]> scanDrive,\n" +
			"        Func<string, Cursor, (Entry[], Cursor)> readJournal,\n" +
			"        Func<string, Cursor, CancellationToken, IAsyncEnumerable<(Entry[], Cursor)>>? watch = null)\n" +
			"    {\n" +
			"        _q = queryCursor;\n" +
			"    }\n" +
			"}\n";
		const filePath = writeFile("Funcs.cs", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxParams: 6 }));
		const paramDiags = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(paramDiags).toHaveLength(0);
	});

	it("still counts genuine top-level params past the limit despite generic types", async () => {
		// Eight real parameters, one of which carries an internal generic comma:
		// the count must be eight (not nine), and the finding must still fire.
		const content =
			"void ParseAllChunks(\n" +
			"    ReadChunkFn readChunk, void* readContext, std::array<uint8_t*, 2>& buf,\n" +
			"    unsigned numThreads, const FilterSpec& filter, PathLookup* lookup,\n" +
			"    uint64_t totalRecords, ParseState& state) {\n" +
			"    return;\n" +
			"}\n";
		const filePath = writeFile("chunks.cpp", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxParams: 6 }));
		const paramDiags = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(paramDiags).toHaveLength(1);
		expect(paramDiags[0].detail).toContain("8 params");
	});

	it("counts a positional record's component list toward too-many-params like any parameter list", async () => {
		// A 9-component `readonly record struct` is still a call-site parameter
		// list - construction with 9 positionals is a real complexity signal, so
		// the record form gets no exemption from the rule.
		const content =
			"public readonly record struct BrokerFrame(\n" +
			"    BrokerFrameKind Kind,\n" +
			"    string? Drive,\n" +
			"    Cursor Cursor,\n" +
			"    Entry[] Entries,\n" +
			"    string? MmfName,\n" +
			"    long RecordCount,\n" +
			"    long ByteLength,\n" +
			"    string? Message,\n" +
			"    string? DrivesSpec)\n" +
			"{\n" +
			'    public string RequireDrive() => Drive ?? throw new InvalidDataException("x");\n' +
			"}\n";
		const filePath = writeFile("BrokerFrame.cs", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxParams: 6 }));
		const paramDiags = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(paramDiags).toHaveLength(1);
		expect(paramDiags[0].detail).toContain("9 params");
	});

	it("counts a positional record class primary constructor toward too-many-params as well", async () => {
		// A bare `;`-terminated record declaration has no body, so the brace-based
		// function-boundary detection treats it like a prototype and skips it
		// (same as a C++ declaration) - give it a body so the counting logic is
		// actually exercised.
		const content =
			"public record class Big(int A, int B, int C, int D, int E, int F, int G) { }\n";
		const filePath = writeFile("Big.cs", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxParams: 6 }));
		const paramDiags = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(paramDiags).toHaveLength(1);
		expect(paramDiags[0].detail).toContain("7 params");
	});

	it("still flags a plain constructor with too many params inside a struct", async () => {
		// A hand-written constructor is a method param list, not a record component
		// list - the same counted-not-exempt policy applies to it too.
		const content =
			"public readonly struct UsnJournalEntry {\n" +
			"    internal UsnJournalEntry(ulong recordNumber, ulong parentRecordNumber,\n" +
			"        long usn, long fileTimeTimestamp, uint reason, uint fileAttributes, string fileName)\n" +
			"    {\n" +
			"        RecordNumber = recordNumber;\n" +
			"    }\n" +
			"}\n";
		const filePath = writeFile("UsnJournalEntry.cs", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxParams: 6 }));
		const paramDiags = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(paramDiags).toHaveLength(1);
		expect(paramDiags[0].detail).toContain("UsnJournalEntry · 7 params");
	});
});

describe("checkComplexity — Python async and wrapped signatures", () => {
	it("detects a long async def", async () => {
		const body = makeLines(100, "    x = 1");
		const content = `async def handler(self):\n${body}\n`;
		const filePath = writeFile("async_fn.py", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 80 }));
		const fnDiags = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		expect(fnDiags.length).toBeGreaterThanOrEqual(1);
		expect(fnDiags[0].detail).toContain("handler");
	});

	it("detects a long function with a wrapped multi-line signature", async () => {
		const params = Array.from({ length: 5 }, (_, k) => `    p${k},`).join("\n");
		const body = makeLines(100, "    y = 2");
		const content = `def build(\n${params}\n):\n${body}\n`;
		const filePath = writeFile("wrapped_fn.py", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 80 }));
		const fnDiags = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		expect(fnDiags.length).toBeGreaterThanOrEqual(1);
		expect(fnDiags[0].detail).toContain("build");
	});

	it("does not flag a documented function with a short body", async () => {
		const doc = makeLines(120, "    word word word");
		const content = `def documented(self):\n    """\n${doc}\n    """\n    return 1\n`;
		const filePath = writeFile("documented.py", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 80 }));
		const fnDiags = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		expect(fnDiags).toHaveLength(0);
	});
});

// A realistic module that mirrors the constructs which slipped past the old
// detector: an async method, a wrapped multi-line signature, a heavily
// documented short function, and a many-required-param method. These assertions
// fail on the pre-0.10.1 code, which is the point of a regression net.
const REALISTIC_PY = `"""Realistic module exercising complexity detection."""
from __future__ import annotations


class Client:
    def __init__(
        self,
        token,
        base_url,
        request=None,
        rate_limiter=None,
    ):
        self.token = token
        self.base_url = base_url
        self.request = request
        self.rate_limiter = rate_limiter
        self.session = None
        self.headers = {}
        self.retries = 3
        self.timeout = 30
        self.connected = False
        self.pool = []
        self.cache = {}
        self.metrics = {}
        self.started = 0
        self.last_error = None
        self.agent = "client"
        self.proxy = None
        self.verify = True
        self.closed = False

    async def send_message(
        self,
        chat_id,
        text,
        *,
        parse_mode=None,
        reply_markup=None,
        disable_notification=None,
        protect_content=None,
        reply_to_message_id=None,
    ):
        """Send a text message.

        Args:
            chat_id: Target chat.
            text: Message body.
            parse_mode: Optional formatting.
            reply_markup: Optional markup.
            disable_notification: Optional silent flag.
            protect_content: Optional protection flag.
            reply_to_message_id: Optional reply target.
        """
        payload = {"chat_id": chat_id, "text": text}
        return await self._post("sendMessage", payload)

    def parse(self):
        """
        A long, well-documented helper.

        This docstring is intentionally long to prove that documentation does
        not count toward function length. It describes behavior in detail, line
        after line, so the physical span is large while the logical body stays
        tiny. None of these lines are code, and the function is not too long.
        """
        return None

    def configure(self, a, b, c, d, e, f, g):
        return (a, b, c, d, e, f, g)
`;

describe("checkComplexity — realistic Python corpus (regression net)", () => {
	const ctx = (filePath: string) =>
		makeContext([filePath], {
			maxFunctionLoc: 15,
			maxFileLoc: 4000,
			maxParams: 6,
			maxNesting: 10,
		});

	it("detects every def and async def (no silent under-detection)", () => {
		const defCount = REALISTIC_PY.split("\n").filter((l) =>
			/^\s*(?:async\s+)?def\s/.test(l),
		).length;
		expect(defCount).toBe(4);
		expect(analyzeFunctions(REALISTIC_PY, ".py")).toHaveLength(defCount);
	});

	it("flags only the genuinely long body, not the documented or async ones", async () => {
		const filePath = writeFile("client.py", REALISTIC_PY);
		const diagnostics = await checkComplexity(ctx(filePath));
		const fn = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		expect(fn).toHaveLength(1);
		expect(fn[0].detail).toContain("__init__");
	});

	it("flags only the many-required-param method, not the optional-kwarg API", async () => {
		const filePath = writeFile("client.py", REALISTIC_PY);
		const diagnostics = await checkComplexity(ctx(filePath));
		const params = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(params).toHaveLength(1);
		expect(params[0].detail).toContain("configure");
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
		expect(nestDiags[0].detail).toContain("deepNest");
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

	it("skips test files across all languages", async () => {
		const files = [
			writeFile("src/users.test.ts", makeLines(50, "expect(x).toBe(1);")),
			writeFile("src/users.spec.ts", makeLines(50, "expect(x).toBe(1);")),
			writeFile("__tests__/users.ts", makeLines(50, "expect(x).toBe(1);")),
			writeFile("tests/integration/auth.py", makeLines(50, "assert x == 1")),
			writeFile("api/test_users.py", makeLines(50, "assert x == 1")),
			writeFile("api/users_test.py", makeLines(50, "assert x == 1")),
			writeFile("conftest.py", makeLines(50, "import pytest")),
			writeFile("pkg/users_test.go", makeLines(50, "t.Fatal(err)")),
			writeFile("src/users_test.rs", makeLines(50, "assert!(x == 1);")),
			writeFile("spec/users_spec.rb", makeLines(50, "expect(x).to eq 1")),
			writeFile("src/test/java/UsersTest.java", makeLines(50, "assertEquals(x, 1);")),
		];
		const diagnostics = await checkComplexity(makeContext(files, { maxFileLoc: 10 }));
		expect(diagnostics).toHaveLength(0);
	});

	it("skips migrations across all languages", async () => {
		const files = [
			writeFile("api/migrations/0001_initial.py", makeLines(50, "pass")),
			writeFile("db/migrate/20240101_create_users.rb", makeLines(50, "true")),
			writeFile("database/migrations/2024_create.php", makeLines(50, "// db")),
			writeFile("prisma/migrations/init/migration.sql", makeLines(50, "SELECT 1;")),
			writeFile("migrations/001_initial.ts", makeLines(50, "const x = 1;")),
		];
		const diagnostics = await checkComplexity(makeContext(files, { maxFileLoc: 10 }));
		expect(diagnostics).toHaveLength(0);
	});

	it("skips fixtures, snapshots, mocks, seeds", async () => {
		const files = [
			writeFile("__fixtures__/sample.ts", makeLines(50, "const x = 1;")),
			writeFile("__snapshots__/users.test.ts.snap", makeLines(50, "x")),
			writeFile("__mocks__/db.ts", makeLines(50, "export const x = 1;")),
			writeFile("seeds/users.ts", makeLines(50, "const x = 1;")),
			writeFile("fixtures/payload.py", makeLines(50, "x = 1")),
		];
		const diagnostics = await checkComplexity(makeContext(files, { maxFileLoc: 10 }));
		expect(diagnostics).toHaveLength(0);
	});

	it("skips generated/build output dirs", async () => {
		const files = [
			writeFile("generated/api.ts", makeLines(50, "const x = 1;")),
			writeFile("dist/index.js", makeLines(50, "var x = 1;")),
			writeFile("target/release/build.rs", makeLines(50, "fn main() {}")),
		];
		const diagnostics = await checkComplexity(makeContext(files, { maxFileLoc: 10 }));
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
		expect(fnDiags[0].detail).toContain("processData");
	});
});

describe("analyzeFunctions — brace masking regressions", () => {
	it("does not inflate readPnpmStoreVersion when a regex replace precedes string concat", () => {
		const content = fs.readFileSync(
			path.join(import.meta.dirname, "../src/commands/fix-force.ts"),
			"utf-8",
		);
		const fn = analyzeFunctions(content, ".ts").find((f) => f.name === "readPnpmStoreVersion");
		expect(fn).toBeDefined();
		expect(fn?.lineCount).toBeLessThanOrEqual(25);
	});

	it("does not inflate collectClassDefinitions when comments mention braces", () => {
		const content = fs.readFileSync(
			path.join(import.meta.dirname, "../src/engines/ai-slop/unused-css.ts"),
			"utf-8",
		);
		const fn = analyzeFunctions(content, ".ts").find((f) => f.name === "collectClassDefinitions");
		expect(fn).toBeDefined();
		expect(fn?.lineCount).toBeLessThanOrEqual(30);
	});
});

// C++ false-positive regression: a function-call expression on a `return` statement
// must NOT be mistaken for a function definition.
describe("checkComplexity — C++ function-call false positive regression", () => {
	// Mirrors a real Win32 source layout:
	//   namespace { ... short wrapper ... }
	//   extern "C" { ... long real code ... }
	// The bug: `return GetOverlappedResult(...)` on the last line of the short wrapper
	// was matched as a function definition header, then brace-scanning from that point
	// consumed the `extern "C" {` block, reporting a ~300-line phantom function.
	const CPP_NAMESPACE_EXTERN_FIXTURE = [
		"#include <windows.h>",
		"",
		"namespace {",
		"",
		"BOOL UsnGetOverlappedResult(HANDLE handle, LPOVERLAPPED overlapped, LPDWORD bytesReturned, BOOL wait) {",
		"    if (ShouldAbort()) {",
		"        SetLastError(ERROR_OPERATION_ABORTED);",
		"        return FALSE;",
		"    }",
		"    return GetOverlappedResult(handle, overlapped, bytesReturned, wait);",
		"}",
		"",
		"}  // namespace",
		"",
		'extern "C" {',
		...Array(60).fill("    int realWork = doStuff();"),
		"}",
	].join("\n");

	it("does NOT report function-too-long for a 6-line C++ wrapper whose last line is a function call", async () => {
		const filePath = writeFile("usn_journal.cpp", CPP_NAMESPACE_EXTERN_FIXTURE);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 80 }));
		const fnDiags = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		// GetOverlappedResult is a CALL, not a definition - must not appear in findings
		const phantom = fnDiags.find((d) => d.detail?.includes("GetOverlappedResult"));
		expect(phantom).toBeUndefined();
	});

	it("does NOT report deep-nesting for the same phantom function", async () => {
		const filePath = writeFile("usn_journal.cpp", CPP_NAMESPACE_EXTERN_FIXTURE);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 80 }));
		const nestDiags = diagnostics.filter((d) => d.rule === "complexity/deep-nesting");
		const phantom = nestDiags.find((d) => d.detail?.includes("GetOverlappedResult"));
		expect(phantom).toBeUndefined();
	});

	it("still detects a genuinely long C++ function in the same namespace/extern-C pattern", async () => {
		const longBody = Array(100).fill("    doWork();").join("\n");
		const content = [
			"namespace {",
			`BOOL TrulyLongFunction(HANDLE h, LPOVERLAPPED o) {\n${longBody}\n    return TRUE;\n}`,
			"}",
		].join("\n");
		const filePath = writeFile("long_real.cpp", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 80 }));
		const fnDiags = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		expect(fnDiags.length).toBeGreaterThanOrEqual(1);
		expect(fnDiags[0].detail).toContain("TrulyLongFunction");
	});

	it("does NOT flag a bare return-call statement in a .cpp file as a function definition", async () => {
		// Minimal repro: a single return statement whose callee name matches the
		// C++ function-definition pattern regex.
		const content = [
			"namespace {",
			"BOOL Wrapper(HANDLE h) {",
			"    return SomeApiCall(h, nullptr, 0);",
			"}",
			"}",
		].join("\n");
		const filePath = writeFile("wrapper.cpp", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 80 }));
		const fnDiags = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		const phantom = fnDiags.find((d) => d.detail?.includes("SomeApiCall"));
		expect(phantom).toBeUndefined();
	});
});

// Header coverage: inline / class-member function bodies in C++ headers must be
// nesting-checked, while declaration prototypes in the same headers must not be
// mistaken for definitions (they carry no body).
describe("checkComplexity — C++ header nesting coverage", () => {
	const DEEP_INLINE_BODY = [
		"    if (a) {",
		"        if (b) {",
		"            if (c) {",
		"                if (d) {",
		"                    doWork();",
		"                }",
		"            }",
		"        }",
		"    }",
	].join("\n");

	for (const ext of [".hpp", ".h", ".hh", ".hxx", ".cc", ".cxx"]) {
		it(`detects deep nesting in an inline function body in a ${ext} file`, async () => {
			const content = [
				"struct Widget {",
				`    void render() {\n${DEEP_INLINE_BODY}\n    }`,
				"};",
			].join("\n");
			const filePath = writeFile(`widget${ext}`, content);
			const diagnostics = await checkComplexity(makeContext([filePath], { maxNesting: 2 }));
			const nestDiags = diagnostics.filter((d) => d.rule === "complexity/deep-nesting");
			const hit = nestDiags.find((d) => d.detail?.includes("render"));
			expect(hit).toBeDefined();
		});
	}

	it("does NOT treat a declaration prototype in a header as a function definition", async () => {
		// The prototype's `;` arrives before any `{`, and the deeply-nested inline
		// definition that follows would be mis-attributed to it without the guard.
		const content = [
			"struct Widget {",
			"    void declaredOnly(int x);",
			`    void inlineDefined() {\n${DEEP_INLINE_BODY}\n    }`,
			"};",
		].join("\n");
		const filePath = writeFile("widget.hpp", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxNesting: 2 }));
		const nestDiags = diagnostics.filter((d) => d.rule === "complexity/deep-nesting");
		expect(nestDiags.find((d) => d.detail?.includes("declaredOnly"))).toBeUndefined();
		expect(nestDiags.find((d) => d.detail?.includes("inlineDefined"))).toBeDefined();
	});

	it("does NOT flag a typedef'd function pointer in a header as a definition", async () => {
		const content = [
			"typedef void (*Callback)(int code);",
			"typedef int (*Reducer)(int a, int b);",
		].join("\n");
		const filePath = writeFile("callbacks.h", content);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxNesting: 2 }));
		const nestDiags = diagnostics.filter((d) => d.rule === "complexity/deep-nesting");
		expect(nestDiags).toHaveLength(0);
	});
});

// C#/C++ function detection: constructors, multi-modifier/complex-return methods,
// out-of-line (scoped) definitions, and multi-line signatures - plus adversarial
// cases (calls, control flow, prototypes) that must NOT be counted as functions.
describe("analyzeFunctions — C#/C++ constructor & multi-line signature detection", () => {
	const names = (src: string, ext: string) => analyzeFunctions(src, ext).map((f) => f.name);

	it("detects a C# constructor (no return type)", () => {
		const src = "class C {\n  public C(int a, int b) {\n    if (a) { work(); }\n  }\n}";
		const fns = analyzeFunctions(src, ".cs");
		const ctor = fns.find((f) => f.name === "C");
		expect(ctor).toBeDefined();
		expect(ctor?.paramCount).toBe(2);
	});

	it("detects a C# method with multiple modifiers and a generic return type", () => {
		const src =
			"class C {\n  public async Task<int> DoAsync(int a) {\n    if (a) { return a; }\n    return 0;\n  }\n}";
		expect(names(src, ".cs")).toContain("DoAsync");
	});

	// Regression: a statement-position multi-line awaited call
	// (`await WriteFrameAsync(...)` with a `.ConfigureAwait(false);` continuation)
	// was once shape-matched as a function definition, and brace-scanning from it
	// swallowed the rest of the enclosing method - misreporting the real method as
	// too long. The call must not register as a function, and the enclosing
	// method's length must stay correct.
	it("does not treat a multi-line awaited call as a C# function definition", () => {
		const src = [
			"class C",
			"{",
			"    public async Task StopAsync()",
			"    {",
			"        try",
			"        {",
			"            await WriteFrameAsync(BrokerProtocol.WriteEndWatch, CancellationToken.None)",
			"                .ConfigureAwait(false);",
			"        }",
			"        catch (Exception exception) when (exception is not OperationCanceledException)",
			"        {",
			"            _ = exception;",
			"        }",
			"    }",
			"",
			"    public int After()",
			"    {",
			"        return 1;",
			"    }",
			"}",
		].join("\n");
		const fns = analyzeFunctions(src, ".cs");
		expect(fns.map((f) => f.name)).toEqual(["StopAsync", "After"]);
		const stop = fns.find((f) => f.name === "StopAsync");
		expect(stop?.lineCount).toBe(12);
	});

	it("detects a C# method with a multi-line (wrapped) signature", () => {
		const src = "class C {\n  public int Foo(\n    int a,\n    int b) {\n    return a;\n  }\n}";
		const foo = analyzeFunctions(src, ".cs").find((f) => f.name === "Foo");
		expect(foo).toBeDefined();
		expect(foo?.paramCount).toBe(2);
	});

	it("counts deep nesting inside a C# method (regression: .cs must be detected)", async () => {
		const body = ["if (a) {", "if (b) {", "if (c) {", "work();", "}", "}", "}"]
			.map((l) => `      ${l}`)
			.join("\n");
		const src = `class C {\n  public void Deep(int a, int b, int c) {\n${body}\n  }\n}`;
		const filePath = writeFile("Deep.cs", src);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxNesting: 2 }));
		const nest = diagnostics.filter((d) => d.rule === "complexity/deep-nesting");
		expect(nest.find((d) => d.detail?.includes("Deep"))).toBeDefined();
	});

	it("detects a C# too-many-params method", async () => {
		const src =
			"class C {\n  public void Many(int a, int b, int c, int d, int e, int f, int g) {\n    work();\n  }\n}";
		const filePath = writeFile("Many.cs", src);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxParams: 6 }));
		const params = diagnostics.filter((d) => d.rule === "complexity/too-many-params");
		expect(params.find((d) => d.detail?.includes("Many"))).toBeDefined();
	});

	it("detects C++ out-of-line scoped method, constructor, and destructor", () => {
		expect(names("void Widget::doThing(int a) {\n  work();\n}", ".cpp")).toContain(
			"Widget::doThing",
		);
		expect(names("Widget::Widget(int a) {\n  init();\n}", ".cpp")).toContain("Widget::Widget");
		expect(names("Widget::~Widget() {\n  cleanup();\n}", ".cpp")).toContain("Widget::~Widget");
	});

	it("detects a C++ method with a multi-line (wrapped) signature", () => {
		const src =
			"int compute(\n    int a,\n    int b) {\n  if (a) { if (b) { return a; } }\n  return 0;\n}";
		const compute = analyzeFunctions(src, ".cpp").find((f) => f.name === "compute");
		expect(compute).toBeDefined();
		expect(compute?.maxNesting).toBe(2);
		expect(compute?.paramCount).toBe(2);
	});

	it("does NOT count C# method calls or control-flow as functions", () => {
		const src =
			"class C {\n  void M() {\n    Console.WriteLine(x);\n    DoThing(a, b);\n    if (a) { }\n    foreach (var x in y) { }\n  }\n}";
		expect(names(src, ".cs")).toEqual(["M"]);
	});

	it("does NOT count a C# field initializer or property as a function", () => {
		const src =
			"class C {\n  public static readonly int[] V = Build(x);\n  public int Count { get; set; }\n}";
		expect(analyzeFunctions(src, ".cs")).toHaveLength(0);
	});

	it("does NOT count a C++ static-call statement as a function", () => {
		const src = "void M() {\n  Foo::Bar(a, b, c, d, e, f, g);\n}";
		expect(names(src, ".cpp")).toEqual(["M"]);
	});

	it("does NOT count a C++ prototype in a header as a function", () => {
		expect(analyzeFunctions("class C {\n  void declaredOnly(int x);\n};", ".hpp")).toHaveLength(0);
	});

	it("detects bare in-class C++ constructors and destructors", () => {
		expect(names("class C {\n  Widget(int a) {\n    init();\n  }\n};", ".cpp")).toContain("Widget");
		expect(names("class C {\n  ~Widget() {\n    cleanup();\n  }\n};", ".cpp")).toContain("~Widget");
		expect(names("class C {\n  Widget(int a) : x_(a) {\n    init();\n  }\n};", ".cpp")).toContain(
			"Widget",
		);
	});

	it("counts nesting inside a bare in-class C++ constructor", () => {
		const src = "class C {\n  Widget(int a) {\n    if (a) { if (a) { if (a) { go(); } } }\n  }\n};";
		const ctor = analyzeFunctions(src, ".cpp").find((f) => f.name === "Widget");
		expect(ctor?.maxNesting).toBe(3);
	});

	it("does NOT mistake C++ control-flow or calls for bare constructors", () => {
		expect(names("void M() {\n  if (a) { }\n  while (b) { }\n  switch (c) { }\n}", ".cpp")).toEqual(
			["M"],
		);
		expect(names("void M() {\n  doThing(a, b);\n  int y = foo(a) + bar(b);\n}", ".cpp")).toEqual([
			"M",
		]);
	});

	it("does NOT apply bare-constructor detection to C (.c) files", () => {
		expect(analyzeFunctions("Widget(a) {\n  init();\n}", ".c")).toHaveLength(0);
	});
});

// A C++ member-initializer list can carry brace initialization (`value_{0}`),
// whose braces open and close before the real constructor body starts. Taking
// the first depth-1 brace as the body would end the function on the initializer
// line and hide the whole body from the length and nesting checks.
describe("analyzeFunctions: C++ member-initializer lists", () => {
	it("spans the real body of an out-of-line constructor with brace initializers", () => {
		const src = [
			"Widget::Widget()",
			"    : value_{0},",
			'      name_{"x"} {',
			"  stepOne();",
			"  if (value_) {",
			"    stepTwo();",
			"  }",
			"  stepThree();",
			"}",
		].join("\n");
		const ctor = analyzeFunctions(src, ".cpp").find((f) => f.name === "Widget::Widget");
		expect(ctor).toBeDefined();
		expect(ctor?.lineCount).toBe(9);
		expect(ctor?.maxNesting).toBe(1);
	});

	it("spans the real body of a bare in-class constructor with brace initializers", () => {
		const src = [
			"class Widget {",
			"  Widget(int a)",
			"      : value_{a}",
			"  {",
			"    stepOne();",
			"    stepTwo();",
			"  }",
			"};",
		].join("\n");
		const ctor = analyzeFunctions(src, ".cpp").find((f) => f.name === "Widget");
		expect(ctor).toBeDefined();
		expect(ctor?.lineCount).toBe(6);
	});

	it("handles paren, brace, templated, and nested-brace initializers together", () => {
		const src = [
			"Widget::Widget(int a)",
			"    : Base<int, float>{a},",
			"      other_(a, a),",
			"      matrix_{{1, 2}, {3, 4}},",
			"      handler_([]{ return 1; }) {",
			"  stepOne();",
			"  stepTwo();",
			"}",
		].join("\n");
		const ctor = analyzeFunctions(src, ".cpp").find((f) => f.name === "Widget::Widget");
		expect(ctor?.lineCount).toBe(8);
	});

	it("reports a long constructor body hidden behind an initializer list", async () => {
		const body = Array.from({ length: 30 }, (_, index) => `  step${index}();`).join("\n");
		const src = `Widget::Widget()\n    : value_{0},\n      other_{1}\n{\n${body}\n}\n`;
		const filePath = writeFile("Widget.cpp", src);
		const diagnostics = await checkComplexity(makeContext([filePath], { maxFunctionLoc: 10 }));
		const tooLong = diagnostics.filter((d) => d.rule === "complexity/function-too-long");
		expect(tooLong.find((d) => d.detail?.includes("Widget::Widget"))).toBeDefined();
	});

	it("leaves a constructor with no initializer list unchanged", () => {
		const src = ["Widget::Widget()", "{", "  stepOne();", "  stepTwo();", "}"].join("\n");
		const ctor = analyzeFunctions(src, ".cpp").find((f) => f.name === "Widget::Widget");
		expect(ctor?.lineCount).toBe(5);
	});

	it("leaves a C# base-constructor initializer unchanged", () => {
		const src = [
			"class C {",
			"  public C(int a)",
			"    : base(a)",
			"  {",
			"    stepOne();",
			"    stepTwo();",
			"  }",
			"}",
		].join("\n");
		const ctor = analyzeFunctions(src, ".cs").find((f) => f.name === "C");
		expect(ctor?.lineCount).toBe(6);
	});

	it("handles a ternary and a qualifier around the initializer list", () => {
		const src = [
			"Widget::Widget(int a) noexcept",
			"    : value_{a > 0 ? 1 : 2},",
			"      flag_(a ? true : false) {",
			"  stepOne();",
			"}",
		].join("\n");
		const ctor = analyzeFunctions(src, ".cpp").find((f) => f.name === "Widget::Widget");
		expect(ctor?.lineCount).toBe(5);
	});

	it("still skips a defaulted constructor and a prototype with default arguments", () => {
		expect(analyzeFunctions("Widget::Widget() = default;\n", ".cpp")).toHaveLength(0);
		expect(analyzeFunctions("class C {\n  void f(int a = 0);\n};", ".hpp")).toHaveLength(0);
	});

	it("leaves a TypeScript return-type annotation unchanged", () => {
		const objectReturn = ["function shape(a) : { x: number } {", "  return { x: a };", "}"].join(
			"\n",
		);
		const shape = analyzeFunctions(objectReturn, ".ts").find((f) => f.name === "shape");
		expect(shape?.lineCount).toBe(3);

		const genericReturn = ["function load(a): Promise<void> {", "  return go(a);", "}"].join("\n");
		const load = analyzeFunctions(genericReturn, ".ts").find((f) => f.name === "load");
		expect(load?.lineCount).toBe(3);
	});

	it("spans the body of an in-class constructor declared in a header", () => {
		const src = [
			"class Widget {",
			" public:",
			"  Widget(int a)",
			"      : value_{a},",
			"        other_{0}",
			"  {",
			"    stepOne();",
			"    stepTwo();",
			"  }",
			"};",
		].join("\n");
		const ctor = analyzeFunctions(src, ".hpp").find((f) => f.name === "Widget");
		expect(ctor?.lineCount).toBe(7);
	});

	it("spans the body past a comment or a brace-bearing string in the list", () => {
		const src = [
			"Widget::Widget()",
			"    : value_{0},  // seeded",
			'      /* wide */ name_{"}{"} {',
			"  stepOne();",
			"  stepTwo();",
			"}",
		].join("\n");
		const ctor = analyzeFunctions(src, ".cpp").find((f) => f.name === "Widget::Widget");
		expect(ctor?.lineCount).toBe(6);
	});

	it("spans the body past an initializer holding a multi-line lambda", () => {
		const src = [
			"Widget::Widget()",
			"    : handler_([] {",
			"        stepOne();",
			"        return 1;",
			"      }),",
			"      value_{0} {",
			"  stepTwo();",
			"}",
		].join("\n");
		const ctor = analyzeFunctions(src, ".cpp").find((f) => f.name === "Widget::Widget");
		expect(ctor?.lineCount).toBe(8);
	});

	it("spans the body of a constructor with a long member list", () => {
		const members = Array.from(
			{ length: 60 },
			(_, index) => `${index === 0 ? "    : " : "      "}member${index}_{${index}},`,
		);
		const src = ["Widget::Widget()", ...members, "      last_{1} {", "  stepOne();", "}"].join(
			"\n",
		);
		const ctor = analyzeFunctions(src, ".cpp").find((f) => f.name === "Widget::Widget");
		expect(ctor?.lineCount).toBe(64);
	});

	// A function-try-block puts `try` between the last initializer and the body,
	// so the body brace is one token further along than the usual case.
	it("spans the body of a function-try-block constructor", () => {
		const src = [
			"Widget::Widget()",
			"    : value_{0},",
			"      other_{1}",
			"try {",
			"  stepOne();",
			"  stepTwo();",
			"}",
			"catch (...) {",
			"}",
		].join("\n");
		const ctor = analyzeFunctions(src, ".cpp").find((f) => f.name === "Widget::Widget");
		expect(ctor?.lineCount).toBe(7);
	});
});
