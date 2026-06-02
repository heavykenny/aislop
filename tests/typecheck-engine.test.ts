import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTypecheck } from "../src/engines/lint/typecheck.js";
import type { EngineContext } from "../src/engines/types.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const NODE_MODULES = path.join(PROJECT_ROOT, "node_modules");

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const linkNodeModules = (): void => {
	fs.symlinkSync(NODE_MODULES, path.join(tmpDir, "node_modules"));
};

const buildContext = (): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["typescript"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: true },
	},
});

const baseTsconfig = {
	compilerOptions: {
		target: "ES2020",
		module: "ESNext",
		moduleResolution: "Bundler",
		strict: true,
		noEmit: true,
		skipLibCheck: true,
	},
	include: ["src"],
};

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-typecheck-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runTypecheck", () => {
	it("returns no diagnostics for a clean TypeScript project", async () => {
		linkNodeModules();
		writeFile("tsconfig.json", JSON.stringify(baseTsconfig));
		writeFile("src/index.ts", "export const greet = (name: string): string => `hi ${name}`;\n");

		const diagnostics = await runTypecheck(buildContext());

		expect(diagnostics).toEqual([]);
	}, 30_000);

	it("reports a single TS2322 diagnostic on a deliberate type mismatch", async () => {
		linkNodeModules();
		writeFile("tsconfig.json", JSON.stringify(baseTsconfig));
		writeFile("src/bug.ts", "export const port: number = 'eight';\n");

		const diagnostics = await runTypecheck(buildContext());

		expect(diagnostics).toHaveLength(1);
		const [diag] = diagnostics;
		expect(diag.engine).toBe("lint");
		expect(diag.rule).toBe("typescript/TS2322");
		expect(diag.severity).toBe("error");
		expect(diag.fixable).toBe(false);
		expect(diag.filePath).toBe(path.join("src", "bug.ts"));
		expect(diag.line).toBe(1);
		expect(diag.column).toBeGreaterThan(0);
	}, 30_000);

	it("dedupes the same error reported by two tsconfigs in a monorepo", async () => {
		linkNodeModules();
		const sharedSource = "export const port: number = 'eight';\n";
		writeFile(
			"packages/a/tsconfig.json",
			JSON.stringify({ ...baseTsconfig, include: ["../../shared"] }),
		);
		writeFile(
			"packages/b/tsconfig.json",
			JSON.stringify({ ...baseTsconfig, include: ["../../shared"] }),
		);
		writeFile("shared/bug.ts", sharedSource);

		const diagnostics = await runTypecheck(buildContext());

		const ts2322 = diagnostics.filter((d) => d.rule === "typescript/TS2322");
		expect(ts2322).toHaveLength(1);
		expect(ts2322[0].filePath.endsWith("bug.ts")).toBe(true);
	}, 60_000);

	it("skips reference-only tsconfigs with no files/include/extends", async () => {
		linkNodeModules();
		writeFile(
			"tsconfig.json",
			JSON.stringify({ files: [], references: [{ path: "./packages/a" }] }),
		);
		writeFile("packages/a/tsconfig.json", JSON.stringify(baseTsconfig));
		writeFile("packages/a/src/index.ts", "export const ok: number = 1;\n");

		const diagnostics = await runTypecheck(buildContext());

		expect(diagnostics).toEqual([]);
	}, 30_000);
});
