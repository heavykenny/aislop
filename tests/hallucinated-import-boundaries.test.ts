import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectHallucinatedImports } from "../src/engines/ai-slop/hallucinated-imports.js";
import { extractJsImports } from "../src/engines/ai-slop/hallucinated-imports-js.js";
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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-import-boundaries-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("JavaScript import evidence boundaries", () => {
	it("keeps scanning after a closed one-line template literal", () => {
		const imports = extractJsImports(
			['const marker = "`";', 'import value from "real-hallucinated-package";'].join("\n"),
		);

		expect(imports).toEqual([{ spec: "real-hallucinated-package", line: 2 }]);
	});

	it("accepts only relative file URL replacements from Vite config", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
		writeFile("src/local.ts", "export const local = true;\n");
		writeFile(
			"vite.config.ts",
			[
				'import { fileURLToPath } from "node:url";',
				"export default { resolve: { alias: {",
				'local: fileURLToPath(new URL("./src", import.meta.url)),',
				'ghost: fileURLToPath(new URL("file:///tmp/outside-module", import.meta.url)),',
				"} } };",
			].join("\n"),
		);
		writeFile(
			"src/app.ts",
			[
				'import { local } from "local/local";',
				'import value from "ghost/value";',
				"local; value;",
			].join("\n"),
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([
			expect.objectContaining({
				filePath: "src/app.ts",
				message: expect.stringContaining("ghost"),
			}),
		]);
	});

	it("ignores alias-shaped comments and strings in Vite config", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
		writeFile(
			"vite.config.ts",
			[
				'const example = `alias: { fromString: "./src" }`;',
				'// alias: { fromComment: "./src" }',
				"export default { resolve: {} };",
			].join("\n"),
		);
		writeFile(
			"src/app.ts",
			[
				'import first from "fromString/value";',
				'import second from "fromComment/value";',
				"first; second;",
			].join("\n"),
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(2);
	});

	it("rejects package imports targets that escape their package", async () => {
		writeFile("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
		writeFile(
			"packages/app/package.json",
			JSON.stringify({ name: "app", imports: { "#ghost": "./../../shared/src/value.ts" } }),
		);
		writeFile("packages/shared/src/value.ts", "export const value = true;\n");
		writeFile("packages/app/src/app.ts", 'import value from "#ghost";\nvalue;\n');

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([
			expect.objectContaining({
				filePath: "packages/app/src/app.ts",
				message: expect.stringContaining("#ghost"),
			}),
		]);
	});

	it("fails closed for deeply nested package imports targets", async () => {
		const deepTarget = `${"[".repeat(20_000)}"./src/value.ts"${"]".repeat(20_000)}`;
		writeFile("package.json", `{"name":"app","imports":{"#deep":${deepTarget}}}`);
		writeFile("src/value.ts", "export const value = true;\n");
		writeFile("src/app.ts", 'import value from "#deep";\nvalue;\n');

		await expect(detectHallucinatedImports(buildContext())).resolves.toEqual([
			expect.objectContaining({ message: expect.stringContaining("#deep") }),
		]);
	});

	it("fails closed for deeply nested declaration export targets", async () => {
		const deepTarget = `${"[".repeat(20_000)}"./src/modules.d.ts"${"]".repeat(20_000)}`;
		writeFile("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
		writeFile(
			"packages/types/package.json",
			`{"name":"types-package","exports":{"./modules":${deepTarget}}}`,
		);
		writeFile("packages/types/src/modules.d.ts", 'declare module "deep:virtual";\n');
		writeFile(
			"packages/consumer/tsconfig.json",
			JSON.stringify({ compilerOptions: { types: ["types-package/modules"] } }),
		);
		writeFile("packages/consumer/app.ts", 'import value from "deep:virtual";\nvalue;\n');

		await expect(detectHallucinatedImports(buildContext())).resolves.toEqual([
			expect.objectContaining({ message: expect.stringContaining("deep:virtual") }),
		]);
	});
});
