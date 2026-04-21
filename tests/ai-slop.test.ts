import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectOverAbstraction } from "../src/engines/ai-slop/abstractions.js";
import { detectTrivialComments } from "../src/engines/ai-slop/comments.js";
import { detectSwallowedExceptions } from "../src/engines/ai-slop/exceptions.js";
import { aiSlopEngine } from "../src/engines/ai-slop/index.js";
import type { EngineContext } from "../src/engines/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

const makeContext = (files: string[]): EngineContext => ({
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

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ai-slop-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── detectTrivialComments ────────────────────────────────────────────────────

describe("detectTrivialComments", () => {
	it("returns no diagnostics for an empty file", async () => {
		const filePath = writeFile("empty.ts", "");
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics).toHaveLength(0);
	});

	it("returns no diagnostics for meaningful comments", async () => {
		const filePath = writeFile(
			"good.ts",
			[
				"// NOTE: this regex is intentionally greedy due to backtracking limits",
				"const pattern = /foo/;",
				"// TODO: replace with binary search once dataset exceeds 10k items",
				"function findItem(arr: number[]) { return arr.find(x => x > 0); }",
			].join("\n"),
		);
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics).toHaveLength(0);
	});

	it("detects 'This function does X' comment", async () => {
		const filePath = writeFile(
			"bad.ts",
			"// This function calculates the total\nfunction calculateTotal() { return 0; }",
		);
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].rule).toBe("ai-slop/trivial-comment");
		expect(diagnostics[0].severity).toBe("warning");
		expect(diagnostics[0].engine).toBe("ai-slop");
	});

	it("detects 'Import X' comment before an import", async () => {
		const filePath = writeFile(
			"imports.ts",
			"// Importing the user service\nimport { UserService } from './user';",
		);
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
	});

	it("detects 'Initialize X' comment", async () => {
		const filePath = writeFile(
			"init.ts",
			"// Initialize the database connection\nconst db = connect();",
		);
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
	});

	it("detects 'Return X' comment", async () => {
		const filePath = writeFile(
			"return.ts",
			"function getValue() {\n  // Return the computed value\n  return 42;\n}",
		);
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
	});

	it("detects 'Check if X' comment", async () => {
		const filePath = writeFile(
			"check.ts",
			"// Check if user is authenticated\nif (user.isAuth) { doSomething(); }",
		);
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
	});

	it("detects 'Loop through X' comment", async () => {
		const filePath = writeFile(
			"loop.ts",
			"// Loop through all users\nfor (const user of users) { process(user); }",
		);
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
	});

	it("detects 'Create a new X' comment", async () => {
		const filePath = writeFile(
			"create.ts",
			"// Create a new user object\nconst user = new User();",
		);
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
	});

	it("detects 'Get the X' comment", async () => {
		const filePath = writeFile("get.ts", "// Get the current user\nconst user = getCurrentUser();");
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
	});

	it("reports correct line numbers", async () => {
		const filePath = writeFile(
			"lines.ts",
			"const a = 1;\nconst b = 2;\n// Return the sum\nreturn a + b;",
		);
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].line).toBe(3);
	});

	it("skips non-source files (.md, .txt)", async () => {
		const filePath = writeFile("README.md", "// This function does something\n# Docs");
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		// .md is not in SOURCE_EXTENSIONS so file should be filtered out
		expect(diagnostics).toHaveLength(0);
	});

	it("reports relative file paths, not absolute", async () => {
		const filePath = writeFile("subdir/bad.ts", "// Initialize the app\nconst app = new App();");
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(path.isAbsolute(diagnostics[0].filePath)).toBe(false);
	});

	it("marks diagnostics as fixable", async () => {
		const filePath = writeFile("fix.ts", "// Define the user class\nclass User {}");
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].fixable).toBe(true);
	});

	it("returns empty array when files list is empty", async () => {
		const diagnostics = await detectTrivialComments(makeContext([]));
		expect(diagnostics).toHaveLength(0);
	});

	it("handles Python trivial comments (# prefix)", async () => {
		const filePath = writeFile(
			"app.py",
			"# This function validates the user\ndef validate_user(user):\n    return True",
		);
		const diagnostics = await detectTrivialComments(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
	});
});

// ─── detectSwallowedExceptions ────────────────────────────────────────────────

describe("detectSwallowedExceptions", () => {
	it("returns no diagnostics for files with proper error handling", async () => {
		const filePath = writeFile(
			"good.ts",
			[
				"async function fetchData() {",
				"  try {",
				"    return await api.get('/data');",
				"  } catch (error) {",
				"    logger.error('fetchData failed', { error });",
				"    throw error;",
				"  }",
				"}",
			].join("\n"),
		);
		const diagnostics = await detectSwallowedExceptions(makeContext([filePath]));
		expect(diagnostics).toHaveLength(0);
	});

	it("detects empty catch block in TypeScript", async () => {
		const filePath = writeFile("empty-catch.ts", "try { doSomething(); } catch (e) {}");
		const diagnostics = await detectSwallowedExceptions(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].rule).toBe("ai-slop/swallowed-exception");
		expect(diagnostics[0].severity).toBe("error");
		expect(diagnostics[0].engine).toBe("ai-slop");
	});

	it("detects empty catch block in JavaScript", async () => {
		const filePath = writeFile("empty-catch.js", "try { doSomething(); } catch (err) {}");
		const diagnostics = await detectSwallowedExceptions(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
	});

	it("detects catch block with only console.log", async () => {
		const filePath = writeFile(
			"console-catch.ts",
			"try { run(); } catch (error) { console.log(error); }",
		);
		const diagnostics = await detectSwallowedExceptions(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].message).toContain("logs error");
	});

	it("detects Python bare except with pass", async () => {
		const filePath = writeFile("swallow.py", "try:\n    do_thing()\nexcept:\n    pass");
		const diagnostics = await detectSwallowedExceptions(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].message).toContain("pass");
	});

	it("detects Python except Exception with pass", async () => {
		const filePath = writeFile(
			"broad_except.py",
			"try:\n    do_thing()\nexcept Exception:\n    pass",
		);
		const diagnostics = await detectSwallowedExceptions(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
	});

	it("does not flag .go files for JS/TS patterns", async () => {
		const filePath = writeFile(
			"main.go",
			'package main\nfunc main() {\n  _ = fmt.Println("hello")\n}',
		);
		// Go files should not match JS catch patterns
		const diagnostics = await detectSwallowedExceptions(makeContext([filePath]));
		const jsCatchDiags = diagnostics.filter((d) => d.message.includes("catch block"));
		expect(jsCatchDiags).toHaveLength(0);
	});

	it("detects catch block with only a comment in TypeScript", async () => {
		const filePath = writeFile(
			"comment-catch.ts",
			"try { doSomething(); } catch (e) { // ignore }",
		);
		const diagnostics = await detectSwallowedExceptions(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
	});

	it("reports correct engine and category", async () => {
		const filePath = writeFile("cat.ts", "try { run(); } catch (e) {}");
		const diagnostics = await detectSwallowedExceptions(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].engine).toBe("ai-slop");
		expect(diagnostics[0].category).toBe("AI Slop");
	});

	it("returns empty array when files list is empty", async () => {
		const diagnostics = await detectSwallowedExceptions(makeContext([]));
		expect(diagnostics).toHaveLength(0);
	});
});

// ─── detectOverAbstraction ────────────────────────────────────────────────────

describe("detectOverAbstraction", () => {
	it("returns no diagnostics for well-named non-trivial functions", async () => {
		const filePath = writeFile(
			"good.ts",
			[
				"export function processUserPayment(userId: string, amount: number): Promise<void> {",
				"  const user = await getUser(userId);",
				"  await chargeCard(user.cardId, amount);",
				"  await sendReceipt(user.email, amount);",
				"}",
			].join("\n"),
		);
		const diagnostics = await detectOverAbstraction(makeContext([filePath]));
		// No thin wrapper or generic naming
		const wrapperDiags = diagnostics.filter((d) => d.rule === "ai-slop/thin-wrapper");
		const namingDiags = diagnostics.filter((d) => d.rule === "ai-slop/generic-naming");
		expect(wrapperDiags).toHaveLength(0);
		expect(namingDiags).toHaveLength(0);
	});

	it("detects a thin wrapper function (only calls another function)", async () => {
		const filePath = writeFile(
			"wrapper.ts",
			"export function getData(id: string) {\n  return fetchData(id);\n}",
		);
		const diagnostics = await detectOverAbstraction(makeContext([filePath]));
		const wrappers = diagnostics.filter((d) => d.rule === "ai-slop/thin-wrapper");
		expect(wrappers.length).toBeGreaterThanOrEqual(1);
		expect(wrappers[0].message).toContain("thin wrapper");
		expect(wrappers[0].severity).toBe("warning");
	});

	it("detects a thin arrow function wrapper", async () => {
		const filePath = writeFile("arrow.ts", "export const getUser = (id: string) => fetchUser(id);");
		const diagnostics = await detectOverAbstraction(makeContext([filePath]));
		const wrappers = diagnostics.filter((d) => d.rule === "ai-slop/thin-wrapper");
		expect(wrappers.length).toBeGreaterThanOrEqual(1);
	});

	it("detects AI-style generic naming: helper1", async () => {
		const filePath = writeFile("names.ts", "function helper1(x: number) { return x * 2; }");
		const diagnostics = await detectOverAbstraction(makeContext([filePath]));
		const naming = diagnostics.filter((d) => d.rule === "ai-slop/generic-naming");
		expect(naming.length).toBeGreaterThanOrEqual(1);
		expect(naming[0].message).toContain("helper1");
	});

	it("detects AI-style generic naming: data1", async () => {
		const filePath = writeFile("names2.ts", "const data1 = getData();");
		const diagnostics = await detectOverAbstraction(makeContext([filePath]));
		const naming = diagnostics.filter((d) => d.rule === "ai-slop/generic-naming");
		expect(naming.length).toBeGreaterThanOrEqual(1);
	});

	it("detects AI-style generic naming: temp2", async () => {
		const filePath = writeFile("names3.ts", "let temp2 = compute();");
		const diagnostics = await detectOverAbstraction(makeContext([filePath]));
		const naming = diagnostics.filter((d) => d.rule === "ai-slop/generic-naming");
		expect(naming.length).toBeGreaterThanOrEqual(1);
	});

	it("reports generic-naming as info severity", async () => {
		const filePath = writeFile("sev.ts", "const result1 = fetchResult();");
		const diagnostics = await detectOverAbstraction(makeContext([filePath]));
		const naming = diagnostics.filter((d) => d.rule === "ai-slop/generic-naming");
		expect(naming.length).toBeGreaterThanOrEqual(1);
		expect(naming[0].severity).toBe("info");
	});

	it("reports thin-wrapper as not fixable", async () => {
		const filePath = writeFile("fix.ts", "function wrap(x: string) {\n  return doThing(x);\n}");
		const diagnostics = await detectOverAbstraction(makeContext([filePath]));
		const wrappers = diagnostics.filter((d) => d.rule === "ai-slop/thin-wrapper");
		if (wrappers.length > 0) {
			expect(wrappers[0].fixable).toBe(false);
		}
	});

	it("returns empty array when files list is empty", async () => {
		const diagnostics = await detectOverAbstraction(makeContext([]));
		expect(diagnostics).toHaveLength(0);
	});
});

// ─── aiSlopEngine (integration) ───────────────────────────────────────────────

describe("aiSlopEngine", () => {
	it("has name 'ai-slop'", () => {
		expect(aiSlopEngine.name).toBe("ai-slop");
	});

	it("returns an EngineResult with correct shape", async () => {
		const filePath = writeFile("clean.ts", "const x = 1;");
		const context = makeContext([filePath]);
		const result = await aiSlopEngine.run(context);
		expect(result.engine).toBe("ai-slop");
		expect(Array.isArray(result.diagnostics)).toBe(true);
		expect(result.skipped).toBe(false);
		expect(typeof result.elapsed).toBe("number");
	});

	it("aggregates diagnostics from all sub-detectors", async () => {
		const filePath = writeFile(
			"mixed.ts",
			[
				"// Initialize the database",
				"const db = connect();",
				"try { run(); } catch (e) {}",
				"function getData(id: string) {\n  return fetchData(id);\n}",
			].join("\n"),
		);
		const context = makeContext([filePath]);
		const result = await aiSlopEngine.run(context);
		const rules = result.diagnostics.map((d) => d.rule);
		expect(rules).toContain("ai-slop/trivial-comment");
		expect(rules).toContain("ai-slop/swallowed-exception");
	});

	it("returns empty diagnostics for a clean file", async () => {
		const filePath = writeFile(
			"clean2.ts",
			[
				"// NOTE: we use binary search here for O(log n) performance",
				"export function binarySearch(arr: number[], target: number): number {",
				"  let lo = 0;",
				"  let hi = arr.length - 1;",
				"  while (lo <= hi) {",
				"    const mid = (lo + hi) >> 1;",
				"    if (arr[mid] === target) return mid;",
				"    if (arr[mid] < target) lo = mid + 1;",
				"    else hi = mid - 1;",
				"  }",
				"  return -1;",
				"}",
			].join("\n"),
		);
		const context = makeContext([filePath]);
		const result = await aiSlopEngine.run(context);
		expect(result.diagnostics).toHaveLength(0);
	});
});
