import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixDuplicateImports } from "../src/engines/ai-slop/duplicate-imports-fix.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const readFile = (relative: string): string =>
	fs.readFileSync(path.join(tmpDir, relative), "utf-8");

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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-dup-imp-fix-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("fixDuplicateImports — merging two imports from the same module", () => {
	it("merges type-only + value imports of the same module", async () => {
		writeFile(
			"src/a.ts",
			[
				`import type { Diagnostic } from "../engines/types.js"`,
				`import { runEngines } from "../engines/orchestrator.js"`,
				`import type { EngineContext, EngineName } from "../engines/types.js"`,
				`export const x = 1`,
				``,
			].join("\n"),
		);

		await fixDuplicateImports(buildContext());

		const out = readFile("src/a.ts");
		expect(out).toContain(
			`import type { Diagnostic, EngineContext, EngineName } from "../engines/types.js";`,
		);
		expect(out).toContain(`import { runEngines } from "../engines/orchestrator.js"`);
		expect(out.match(/from "\.\.\/engines\/types\.js"/g) ?? []).toHaveLength(1);
	});

	it("merges a type-only import alongside value imports as `{ value, type Type }`", async () => {
		writeFile(
			"src/b.ts",
			[
				`import type { AislopConfig } from "../config/index.js"`,
				`import { findConfigDir, RULES_FILE } from "../config/index.js"`,
				`export const y = 2`,
				``,
			].join("\n"),
		);

		await fixDuplicateImports(buildContext());

		const out = readFile("src/b.ts");
		expect(out).toContain(
			`import { findConfigDir, RULES_FILE, type AislopConfig } from "../config/index.js";`,
		);
		expect(out.match(/from "\.\.\/config\/index\.js"/g) ?? []).toHaveLength(1);
	});

	it("merges three value imports into one", async () => {
		writeFile(
			"src/c.ts",
			[
				`import { A } from "./mod"`,
				`import { B } from "./mod"`,
				`import { C } from "./mod"`,
				``,
			].join("\n"),
		);

		await fixDuplicateImports(buildContext());

		const out = readFile("src/c.ts");
		expect(out).toContain(`import { A, B, C } from "./mod";`);
		expect(out.match(/from "\.\/mod"/g) ?? []).toHaveLength(1);
	});

	it("preserves aliases when merging", async () => {
		writeFile(
			"src/d.ts",
			[`import { A as RenamedA } from "./mod"`, `import { B } from "./mod"`, ``].join("\n"),
		);

		await fixDuplicateImports(buildContext());

		const out = readFile("src/d.ts");
		expect(out).toContain(`import { A as RenamedA, B } from "./mod";`);
	});

	it("merges default + named import from the same module", async () => {
		writeFile("src/e.ts", [`import D from "./mod"`, `import { A, B } from "./mod"`, ``].join("\n"));

		await fixDuplicateImports(buildContext());

		const out = readFile("src/e.ts");
		expect(out).toContain(`import D, { A, B } from "./mod";`);
	});

	it("does NOT merge when there is a namespace import", async () => {
		const before = [`import * as ns from "./mod"`, `import { A } from "./mod"`, ``].join("\n");
		writeFile("src/ns.ts", before);

		await fixDuplicateImports(buildContext());

		const out = readFile("src/ns.ts");
		expect(out).toBe(before);
	});

	it("leaves single imports alone", async () => {
		const before = [
			`import { runEngines } from "../engines/orchestrator.js"`,
			`import path from "node:path"`,
			``,
		].join("\n");
		writeFile("src/clean.ts", before);

		await fixDuplicateImports(buildContext());

		const out = readFile("src/clean.ts");
		expect(out).toBe(before);
	});

	it("does NOT touch side-effect imports", async () => {
		const before = [`import "./shim-a.js"`, `import "./shim-b.js"`, ``].join("\n");
		writeFile("src/se.ts", before);

		await fixDuplicateImports(buildContext());

		const out = readFile("src/se.ts");
		expect(out).toBe(before);
	});

	it("dedupes named imports if the same symbol is imported twice (different statements)", async () => {
		writeFile(
			"src/dup.ts",
			[`import { A, B } from "./mod"`, `import { A, C } from "./mod"`, ``].join("\n"),
		);

		await fixDuplicateImports(buildContext());

		const out = readFile("src/dup.ts");
		expect(out).toContain(`import { A, B, C } from "./mod";`);
		expect(out.match(/A,/g)?.length ?? 0).toBeLessThanOrEqual(1);
	});
});
