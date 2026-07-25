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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-vite-comments-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Vite alias comment boundaries", () => {
	it("does not use a multiline comment inside an alias object as resolution evidence", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
		writeFile(
			"vite.config.ts",
			[
				"export default {",
				"  resolve: {",
				"    alias: {",
				"      /*",
				'       ghost: "./src",',
				"       */",
				'      real: "./src",',
				"    },",
				"  },",
				"};",
			].join("\n"),
		);
		writeFile("src/real.ts", "export const value = true;\n");
		writeFile(
			"src/app.ts",
			[
				'import fromComment from "ghost/value";',
				'import fromAlias from "real/value";',
				"fromComment; fromAlias;",
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
});
