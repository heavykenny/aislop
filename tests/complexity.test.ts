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
