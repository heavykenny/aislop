import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDeadPatterns } from "../src/engines/ai-slop/dead-patterns.js";
import { detectUnusedImports } from "../src/engines/ai-slop/unused-imports.js";
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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "slop-dead-patterns-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Unused Imports ──────────────────────────────────────────────────────────

describe("unused imports", () => {
	it("detects an unused named import", async () => {
		const filePath = writeFile(
			"unused.ts",
			[
				'import { foo, bar } from "./module";',
				"const x = foo();",
			].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter(
			(d) => d.rule === "ai-slop/unused-import",
		);
		expect(unused.length).toBe(1);
		expect(unused[0].message).toContain("bar");
	});

	it("does not flag used imports", async () => {
		const filePath = writeFile(
			"used.ts",
			[
				'import { readFileSync } from "node:fs";',
				"const data = readFileSync('file.txt', 'utf-8');",
			].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter(
			(d) => d.rule === "ai-slop/unused-import",
		);
		expect(unused).toHaveLength(0);
	});

	it("does not flag side-effect imports", async () => {
		const filePath = writeFile(
			"sideeffect.ts",
			'import "./polyfill";',
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter(
			(d) => d.rule === "ai-slop/unused-import",
		);
		expect(unused).toHaveLength(0);
	});

	it("does not flag type-only imports", async () => {
		const filePath = writeFile(
			"typeonly.ts",
			[
				'import type { SomeType } from "./types";',
				"const x = 1;",
			].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter(
			(d) => d.rule === "ai-slop/unused-import",
		);
		expect(unused).toHaveLength(0);
	});

	it("detects unused default import", async () => {
		const filePath = writeFile(
			"default.ts",
			[
				'import React from "react";',
				"const x = 1;",
			].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter(
			(d) => d.rule === "ai-slop/unused-import",
		);
		expect(unused.length).toBe(1);
		expect(unused[0].message).toContain("React");
	});

	it("detects unused namespace import", async () => {
		const filePath = writeFile(
			"namespace.ts",
			[
				'import * as utils from "./utils";',
				"const x = 1;",
			].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter(
			(d) => d.rule === "ai-slop/unused-import",
		);
		expect(unused.length).toBe(1);
		expect(unused[0].message).toContain("utils");
	});

	it("detects unused Python imports", async () => {
		const filePath = writeFile(
			"unused.py",
			[
				"from os import path, getcwd",
				"print(path.join('a', 'b'))",
			].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter(
			(d) => d.rule === "ai-slop/unused-import",
		);
		expect(unused.length).toBe(1);
		expect(unused[0].message).toContain("getcwd");
	});

	it("marks unused import diagnostics as fixable", async () => {
		const filePath = writeFile(
			"fixable.ts",
			[
				'import { unused } from "./mod";',
				"const x = 1;",
			].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter(
			(d) => d.rule === "ai-slop/unused-import",
		);
		expect(unused.length).toBe(1);
		expect(unused[0].fixable).toBe(true);
	});
});

// ─── Console Leftovers ───────────────────────────────────────────────────────

describe("console leftovers", () => {
	it("detects console.log in TypeScript files", async () => {
		const filePath = writeFile(
			"debug.ts",
			[
				"function process(data: string) {",
				"  console.log(data);",
				"  return data.trim();",
				"}",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter(
			(d) => d.rule === "ai-slop/console-leftover",
		);
		expect(consoleD.length).toBe(1);
		expect(consoleD[0].line).toBe(2);
	});

	it("detects console.debug and console.info", async () => {
		const filePath = writeFile(
			"debug2.ts",
			[
				"console.debug('debugging');",
				"console.info('info message');",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter(
			(d) => d.rule === "ai-slop/console-leftover",
		);
		expect(consoleD.length).toBe(2);
	});

	it("does not flag console.error and console.warn", async () => {
		const filePath = writeFile(
			"errors.ts",
			[
				"console.error('critical');",
				"console.warn('warning');",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter(
			(d) => d.rule === "ai-slop/console-leftover",
		);
		expect(consoleD).toHaveLength(0);
	});

	it("does not flag commented console.log", async () => {
		const filePath = writeFile(
			"commented.ts",
			"// console.log('disabled');",
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter(
			(d) => d.rule === "ai-slop/console-leftover",
		);
		expect(consoleD).toHaveLength(0);
	});

	it("does not flag console in .py files", async () => {
		const filePath = writeFile(
			"notjs.py",
			"console.log('not real');",
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter(
			(d) => d.rule === "ai-slop/console-leftover",
		);
		expect(consoleD).toHaveLength(0);
	});
});

// ─── TODO Stubs ──────────────────────────────────────────────────────────────

describe("todo stubs", () => {
	it("detects TODO comments", async () => {
		const filePath = writeFile(
			"todos.ts",
			[
				"// TODO: implement this properly",
				"function placeholder() { return null; }",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const todos = diagnostics.filter((d) => d.rule === "ai-slop/todo-stub");
		expect(todos.length).toBe(1);
		expect(todos[0].severity).toBe("info");
	});

	it("detects FIXME comments", async () => {
		const filePath = writeFile(
			"fixme.ts",
			"// FIXME: this is broken",
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const todos = diagnostics.filter((d) => d.rule === "ai-slop/todo-stub");
		expect(todos.length).toBe(1);
	});

	it("detects HACK comments", async () => {
		const filePath = writeFile(
			"hack.ts",
			"// HACK: temporary workaround",
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const todos = diagnostics.filter((d) => d.rule === "ai-slop/todo-stub");
		expect(todos.length).toBe(1);
	});

	it("detects Python TODO comments", async () => {
		const filePath = writeFile(
			"todos.py",
			"# TODO: add validation",
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const todos = diagnostics.filter((d) => d.rule === "ai-slop/todo-stub");
		expect(todos.length).toBe(1);
	});

	it("does not flag non-comment TODO mentions", async () => {
		const filePath = writeFile(
			"notcomment.ts",
			'const message = "TODO: fix this";',
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const todos = diagnostics.filter((d) => d.rule === "ai-slop/todo-stub");
		expect(todos).toHaveLength(0);
	});
});

// ─── Dead Code Patterns ──────────────────────────────────────────────────────

describe("dead code patterns", () => {
	it("detects code after return statement", async () => {
		const filePath = writeFile(
			"unreachable.ts",
			[
				"function test() {",
				"  return 42;",
				"  const x = 1;",
				"}",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const unreachable = diagnostics.filter(
			(d) => d.rule === "ai-slop/unreachable-code",
		);
		expect(unreachable.length).toBe(1);
		expect(unreachable[0].line).toBe(3);
	});

	it("does not flag closing brace after return", async () => {
		const filePath = writeFile(
			"ok-return.ts",
			[
				"function test() {",
				"  return 42;",
				"}",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const unreachable = diagnostics.filter(
			(d) => d.rule === "ai-slop/unreachable-code",
		);
		expect(unreachable).toHaveLength(0);
	});

	it("detects constant condition if (false)", async () => {
		const filePath = writeFile(
			"constant.ts",
			[
				"if (false) {",
				"  doSomething();",
				"}",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const constant = diagnostics.filter(
			(d) => d.rule === "ai-slop/constant-condition",
		);
		expect(constant.length).toBe(1);
	});

	it("detects constant condition if (true)", async () => {
		const filePath = writeFile(
			"alwaystrue.ts",
			"if (true) { run(); }",
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const constant = diagnostics.filter(
			(d) => d.rule === "ai-slop/constant-condition",
		);
		expect(constant.length).toBe(1);
	});
});

// ─── Unsafe Type Assertions ──────────────────────────────────────────────────

describe("unsafe type assertions", () => {
	it("detects 'as any' in TypeScript", async () => {
		const filePath = writeFile(
			"unsafe.ts",
			"const data = response.body as any;",
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const asAny = diagnostics.filter(
			(d) => d.rule === "ai-slop/unsafe-type-assertion",
		);
		expect(asAny.length).toBe(1);
	});

	it("detects double assertion 'as unknown as'", async () => {
		const filePath = writeFile(
			"double.ts",
			"const x = value as unknown as SpecificType;",
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const doubleAssert = diagnostics.filter(
			(d) => d.rule === "ai-slop/double-type-assertion",
		);
		expect(doubleAssert.length).toBe(1);
	});

	it("detects @ts-ignore directive", async () => {
		const filePath = writeFile(
			"ignore.ts",
			[
				"// @ts-ignore",
				"const x: number = 'not a number';",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const directives = diagnostics.filter(
			(d) => d.rule === "ai-slop/ts-directive",
		);
		expect(directives.length).toBe(1);
	});

	it("detects @ts-expect-error directive", async () => {
		const filePath = writeFile(
			"expect-error.ts",
			[
				"// @ts-expect-error",
				"const x: number = 'not a number';",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const directives = diagnostics.filter(
			(d) => d.rule === "ai-slop/ts-directive",
		);
		expect(directives.length).toBe(1);
	});

	it("does not flag 'as any' in .js files", async () => {
		const filePath = writeFile(
			"nocheck.js",
			"const data = response.body as any;",
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const asAny = diagnostics.filter(
			(d) => d.rule === "ai-slop/unsafe-type-assertion",
		);
		expect(asAny).toHaveLength(0);
	});

	it("does not flag commented 'as any'", async () => {
		const filePath = writeFile(
			"commented.ts",
			"// const data = response.body as any;",
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const asAny = diagnostics.filter(
			(d) => d.rule === "ai-slop/unsafe-type-assertion",
		);
		expect(asAny).toHaveLength(0);
	});
});

// ─── General ──────────────────────────────────────────────────────────────────

describe("general", () => {
	it("returns empty array when files list is empty", async () => {
		const diagnostics = await detectDeadPatterns(makeContext([]));
		expect(diagnostics).toHaveLength(0);
	});

	it("all diagnostics have engine ai-slop", async () => {
		const filePath = writeFile(
			"mixed.ts",
			[
				'import { unused } from "./mod";',
				"// TODO: fix this",
				"console.log('debug');",
				"const x = value as any;",
			].join("\n"),
		);
		const ctx = makeContext([filePath]);
		const diagnostics = [
			...(await detectDeadPatterns(ctx)),
			...(await detectUnusedImports(ctx)),
		];
		for (const d of diagnostics) {
			expect(d.engine).toBe("ai-slop");
		}
	});

	it("all diagnostics have category AI Slop", async () => {
		const filePath = writeFile(
			"mixed2.ts",
			[
				'import { unused } from "./mod";',
				"// FIXME: broken",
				"console.log('test');",
			].join("\n"),
		);
		const ctx = makeContext([filePath]);
		const diagnostics = [
			...(await detectDeadPatterns(ctx)),
			...(await detectUnusedImports(ctx)),
		];
		for (const d of diagnostics) {
			expect(d.category).toBe("AI Slop");
		}
	});

	it("reports relative file paths", async () => {
		const filePath = writeFile(
			"subdir/test.ts",
			'import { unused } from "./mod";',
		);
		const ctx = makeContext([filePath]);
		const diagnostics = [
			...(await detectDeadPatterns(ctx)),
			...(await detectUnusedImports(ctx)),
		];
		for (const d of diagnostics) {
			expect(path.isAbsolute(d.filePath)).toBe(false);
		}
	});
});
