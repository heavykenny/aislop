import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDuplicateImports } from "../src/engines/ai-slop/duplicate-imports.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const buildContext = (): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["typescript", "javascript"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-dup-import-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectDuplicateImports", () => {
	it("flags two imports from the same module on different lines", async () => {
		writeFile(
			"src/foo.ts",
			`import type { Diagnostic } from "../engines/types.js"
import { runEngines } from "../engines/orchestrator.js"
import type { EngineContext, EngineName } from "../engines/types.js"
export const x = 1
`,
		);

		const diagnostics = await detectDuplicateImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		const [d] = diagnostics;
		expect(d.rule).toBe("ai-slop/duplicate-import");
		expect(d.severity).toBe("warning");
		expect(d.fixable).toBe(true);
		expect(d.line).toBe(3);
		expect(d.message).toContain("../engines/types.js");
		expect(d.message).toContain("line 1");
	});

	it("does not flag a single import per module", async () => {
		writeFile(
			"src/clean.ts",
			`import type { Diagnostic, EngineContext, EngineName } from "../engines/types.js"
import { runEngines } from "../engines/orchestrator.js"
export const y = 2
`,
		);

		const diagnostics = await detectDuplicateImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("flags multiple duplicates correctly (3rd and later occurrences)", async () => {
		writeFile(
			"src/triple.ts",
			`import { A } from "./mod"
import { B } from "./mod"
import { C } from "./mod"
export const z = 3
`,
		);

		const diagnostics = await detectDuplicateImports(buildContext());

		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.map((d) => d.line)).toEqual([2, 3]);
	});

	it("ignores side-effect imports and require/dynamic-import (which legitimately repeat)", async () => {
		writeFile(
			"src/sideeffects.ts",
			`import "./shim-a.js"
import "./shim-b.js"
const a = require("./mod")
const b = require("./mod")
const c = await import("./mod")
const d = await import("./mod")
export {}
`,
		);

		const diagnostics = await detectDuplicateImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag a value import alongside a type-only import from the same module", async () => {
		writeFile(
			"src/consistent-type.ts",
			`import { foo } from "./foo"
import type { FooObj } from "./foo"
export const value = foo
`,
		);

		const diagnostics = await detectDuplicateImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag a value import alongside an inline type-only import from the same module", async () => {
		writeFile(
			"src/inline-type.ts",
			`import { foo } from "./foo"
import { type FooObj } from "./foo"
export const value = foo
`,
		);

		const diagnostics = await detectDuplicateImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("still flags two value imports from the same module (regression preserved)", async () => {
		writeFile(
			"src/two-values.ts",
			`import { a } from "./x"
import { b } from "./x"
export const sum = a
`,
		);

		const diagnostics = await detectDuplicateImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].line).toBe(2);
		expect(diagnostics[0].message).toContain("./x");
	});

	it("works only on JS/TS extensions; ignores .py and similar", async () => {
		writeFile(
			"src/py.py",
			`from x import a
from x import b
`,
		);

		const diagnostics = await detectDuplicateImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("ignores import lines inside a JSDoc @example block", async () => {
		writeFile(
			"src/doc.ts",
			`import {And} from "type-fest"
/**
 * @example
 * import {And} from "type-fest";
 * type T = And<true, true>;
 */
export type T = And<true, true>
`,
		);

		const diagnostics = await detectDuplicateImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag a namespace import alongside a named import from the same module", async () => {
		writeFile(
			"src/ns.ts",
			`import * as core from "../core/index.js"
import { ZodError } from "../core/index.js"
export const x = core
`,
		);

		const diagnostics = await detectDuplicateImports(buildContext());

		expect(diagnostics).toEqual([]);
	});
});
