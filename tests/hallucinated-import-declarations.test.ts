import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectHallucinatedImports } from "../src/engines/ai-slop/hallucinated-imports.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const buildContext = (): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["typescript", "javascript", "python"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-hallucinated-declarations-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ambient declaration module classification", () => {
	it("does not trust a module augmentation after a same-line export token", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
		writeFile(
			"src/augment.d.ts",
			'declare const marker: unique symbol; export {};\ndeclare module "ghost-module" {}\n',
		);
		writeFile("src/app.ts", 'import value from "ghost-module";\nvalue();\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("ghost-module");
	});

	it("keeps import and export words in comments and strings from changing script classification", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
		writeFile(
			"src/ambient.d.ts",
			[
				'const marker = "export import";',
				"// export import should not make this external",
				"/* export import should not make this external */",
				'declare module "ambient-module" {}',
			].join("\n"),
		);
		writeFile("src/app.ts", 'import value from "ambient-module";\nvalue();\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toEqual([]);
	});

	it("keeps import type expressions in the global declaration scope", async () => {
		writeFile(
			"package.json",
			JSON.stringify({ name: "app", dependencies: { "external-package": "1.0.0" } }),
		);
		writeFile(
			"src/ambient.d.ts",
			[
				'type External = import("external-package").External;',
				'declare module "ambient-module" {}',
			].join("\n"),
		);
		writeFile("src/app.ts", 'import value from "ambient-module";\nvalue();\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toEqual([]);
	});

	it("does not trust ambient declarations from excluded paths", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
		writeFile("tests/ambient.d.ts", 'declare module "ghost-module" {}\n');
		writeFile("fixtures/ambient.d.ts", 'declare module "fixture-ghost-module" {}\n');
		writeFile("src/ambient_test.d.ts", 'declare module "suffix-ghost-module" {}\n');
		writeFile("src/test_ambient.d.ts", 'declare module "prefix-ghost-module" {}\n');
		writeFile("src/ambient.story.d.ts", 'declare module "story-ghost-module" {}\n');
		writeFile(
			"src/app.ts",
			[
				'import value from "ghost-module";',
				'import fixture from "fixture-ghost-module";',
				'import suffix from "suffix-ghost-module";',
				'import prefix from "prefix-ghost-module";',
				'import story from "story-ghost-module";',
				"value();",
				"fixture();",
				"suffix();",
				"prefix();",
				"story();",
			].join("\n"),
		);

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags.map((diag) => diag.message)).toEqual([
			expect.stringContaining("ghost-module"),
			expect.stringContaining("fixture-ghost-module"),
			expect.stringContaining("suffix-ghost-module"),
			expect.stringContaining("prefix-ghost-module"),
			expect.stringContaining("story-ghost-module"),
		]);
	});
});
