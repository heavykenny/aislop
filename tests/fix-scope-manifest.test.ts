import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngineContext } from "../src/commands/fix-context.js";
import { scopeIncludesManifestWrites } from "../src/commands/fix-scope.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const contextFor = (files?: string[]): EngineContext =>
	({
		rootDirectory: tmpDir,
		languages: ["typescript"],
		frameworks: [],
		files: files?.map((name) => path.join(tmpDir, name)),
		installedTools: {},
		config: {
			quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
			security: { audit: false, auditTimeout: 0 },
		},
	}) as unknown as EngineContext;

const write = (name: string): void => fs.writeFileSync(path.join(tmpDir, name), "{}");

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-fix-scope-"));
	write("package.json");
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("scopeIncludesManifestWrites", () => {
	it("allows an unscoped fix", () => {
		expect(scopeIncludesManifestWrites(contextFor())).toBe(true);
	});

	it("refuses when a lockfile is selected but the manifest the fixer rewrites is not", () => {
		// The dependency fixers always rewrite package.json. Selecting only the lockfile
		// used to pass the gate, letting a fix edit a file outside the chosen change set.
		write("pnpm-lock.yaml");

		expect(scopeIncludesManifestWrites(contextFor(["pnpm-lock.yaml", "src/app.ts"]))).toBe(false);
	});

	it("refuses when the manifest is selected but a lockfile it rewrites is not", () => {
		write("pnpm-lock.yaml");

		expect(scopeIncludesManifestWrites(contextFor(["package.json"]))).toBe(false);
	});

	it("allows when every file the fixer writes is selected", () => {
		write("pnpm-lock.yaml");

		expect(scopeIncludesManifestWrites(contextFor(["package.json", "pnpm-lock.yaml"]))).toBe(true);
	});

	it("ignores lockfiles the project does not have", () => {
		expect(scopeIncludesManifestWrites(contextFor(["package.json"]))).toBe(true);
	});
});

describe("manifest-only scopes keep project languages for dependency work", () => {
	it("carries the project languages even when the selection has no source file", () => {
		// detectSourceLanguages sees only package.json here and returns nothing, which used
		// to make every dependency fixer skip a scope that explicitly selected the manifest.
		const scopedProjectInfo = {
			languages: [],
			frameworks: [],
			installedTools: {},
		} as unknown as Parameters<typeof createEngineContext>[1];

		const context = createEngineContext(tmpDir, scopedProjectInfo, DEFAULT_CONFIG, {
			scope: {
				files: [path.join(tmpDir, "package.json")],
				testFiles: [],
				projectFiles: [],
				dependencyAuditFiles: [path.join(tmpDir, "package.json")],
				dependencyAuditScope: "scoped",
				scopeLabel: "changed files",
			} as unknown as Parameters<typeof createEngineContext>[3]["scope"],
			dependencyAuditLanguages: ["typescript"],
		});

		expect(context.languages).toEqual([]);
		expect(context.dependencyAuditLanguages).toEqual(["typescript"]);
	});
});
