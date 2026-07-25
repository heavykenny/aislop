import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDefensivePatterns } from "../src/engines/ai-slop/defensive-patterns.js";
import { detectHiddenFallbacks } from "../src/engines/ai-slop/hidden-fallback.js";
import type { EngineContext } from "../src/engines/types.js";

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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-defensive-patterns-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("redundant try/catch", () => {
	it("detects catch blocks that only rethrow the same error", async () => {
		const filePath = writeFile(
			"service.ts",
			[
				"async function loadUser(id: string) {",
				"  try {",
				"    return await fetchUser(id);",
				"  } catch (error) {",
				"    throw error;",
				"  }",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectDefensivePatterns(makeContext([filePath]));
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/redundant-try-catch");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(4);
	});

	it("detects Promise.reject rethrows", async () => {
		const filePath = writeFile(
			"promise.js",
			[
				"async function loadUser() {",
				"  try {",
				"    return await fetchUser();",
				"  } catch (err) {",
				"    return Promise.reject(err);",
				"  }",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectDefensivePatterns(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/redundant-try-catch")).toHaveLength(1);
	});

	it("does not flag catch blocks that add useful context", async () => {
		const filePath = writeFile(
			"context.ts",
			[
				"async function loadUser(id: string) {",
				"  try {",
				"    return await fetchUser(id);",
				"  } catch (error) {",
				"    throw new Error(`Failed to load user ${id}`, { cause: error });",
				"  }",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectDefensivePatterns(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/redundant-try-catch")).toEqual([]);
	});

	it("does not flag catch blocks with cleanup before rethrow", async () => {
		const filePath = writeFile(
			"cleanup.ts",
			[
				"async function writeFile() {",
				"  try {",
				"    return await write();",
				"  } catch (error) {",
				"    await cleanup();",
				"    throw error;",
				"  }",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectDefensivePatterns(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/redundant-try-catch")).toEqual([]);
	});
});

describe("hidden fallback logic", () => {
	it("detects the reported Math.max fallback snippet", async () => {
		const filePath = writeFile(
			"score.ts",
			[
				"function effectiveFiles(diagnostics: Diagnostic[]) {",
				"  // Fallback for direct API use when caller doesn't provide source file count.",
				"  const filesWithDiagnostics = new Set(diagnostics.map((d) => d.filePath)).size;",
				"  return Math.max(1, filesWithDiagnostics);",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([filePath]));
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(4);
		expect(matches[0].filePath).toBe("score.ts");
	});

	it("emits POSIX paths and skips nested fixture files", async () => {
		const sourcePath = writeFile(
			"src/nested/score.ts",
			[
				"function effectiveFiles(diagnostics: Diagnostic[]) {",
				"  // Fallback when source files are missing.",
				"  return Math.max(1, diagnostics.length);",
				"}",
			].join("\n"),
		);
		const fixturePath = writeFile(
			"fixtures/nested/score.ts",
			[
				"function effectiveFiles(diagnostics: Diagnostic[]) {",
				"  // Fallback when source files are missing.",
				"  return Math.max(1, diagnostics.length);",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([sourcePath, fixturePath]));
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback");
		expect(matches).toHaveLength(1);
		expect(matches[0].filePath).toBe("src/nested/score.ts");
	});

	it("detects count fallbacks that hide failed counts", async () => {
		const filePath = writeFile(
			"count.ts",
			[
				"function reportCount(count: number | undefined) {",
				"  // Fallback when the upstream count failed to load.",
				"  return count || 1;",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback")).toHaveLength(1);
	});

	it("detects default values used for impossible missing diagnostics", async () => {
		const filePath = writeFile(
			"diagnostics.ts",
			[
				"function normalizeDiagnostics(value: Diagnostic[] | undefined, defaultValue: Diagnostic[]) {",
				"  // Should never happen: diagnostics are missing after scan completion.",
				"  return value ?? defaultValue;",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback")).toHaveLength(1);
	});

	it("detects catch blocks that return empty success-shaped fallbacks", async () => {
		const filePath = writeFile(
			"catch-fallback.ts",
			[
				"async function loadItems() {",
				"  // Fallback when the fetch failed should not pretend success.",
				"  try {",
				"    return await fetchItems();",
				"  } catch {",
				"    return [];",
				"  }",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([filePath]));
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(6);
	});

	it("detects catch blocks that return a bare empty-string fallback", async () => {
		const filePath = writeFile(
			"catch-empty-string.ts",
			[
				"async function loadName() {",
				"  // Fallback when the fetch failed should not pretend success.",
				"  try {",
				"    return await fetchName();",
				"  } catch {",
				"    return '';",
				"  }",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback")).toHaveLength(1);
	});

	it("does not flag ordinary optional defaults without failure context", async () => {
		const filePath = writeFile(
			"ordinary-defaults.ts",
			[
				"function render(options: { page?: number; label?: string }) {",
				"  const page = options.page ?? 1;",
				"  const label = options.label ?? 'Untitled';",
				"  return `${Math.max(1, page)}:${label}`;",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback")).toEqual([]);
	});

	it("does not flag catch fallbacks that log the caught error", async () => {
		const filePath = writeFile(
			"logged-catch.ts",
			[
				"async function loadItems() {",
				"  try {",
				"    return await fetchItems();",
				"  } catch (error) {",
				"    logger.warn('fetchItems failed; using empty cache result', { error });",
				"    return [];",
				"  }",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback")).toEqual([]);
	});

	it("does not flag bare empty catch fallbacks without extra hidden-failure signals", async () => {
		const filePath = writeFile(
			"bare-empty-catch.ts",
			[
				"async function loadOptionalCache() {",
				"  try {",
				"    return await readOptionalCache();",
				"  } catch {",
				"    return [];",
				"  }",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback")).toEqual([]);
	});

	it("does not flag catch blocks that return typed error outcomes", async () => {
		const filePath = writeFile(
			"typed-outcome.ts",
			[
				"async function loadItems() {",
				"  try {",
				"    return { ok: true, value: await fetchItems() };",
				"  } catch (error) {",
				"    return { ok: false, error };",
				"  }",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback")).toEqual([]);
	});

	it("does not flag error-message string defaults that surface the failure", async () => {
		const filePath = writeFile(
			"error-message-default.ts",
			[
				"function loadTeam(err: unknown) {",
				"  // failed",
				"  const message = (err as Error)?.message || 'Failed to load team';",
				"  return message;",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback")).toEqual([]);
	});

	it("does not flag an empty-string message default", async () => {
		const filePath = writeFile(
			"empty-string-default.ts",
			[
				"function transient(err: unknown) {",
				"  const msg = (err as Error)?.message ?? '';",
				"  return /timeout|reset/.test(msg);",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback")).toEqual([]);
	});

	it("does not flag optional env-var defaults", async () => {
		const filePath = writeFile(
			"env-default.ts",
			[
				"function optional(key: string, fallback: string): string {",
				"  return process.env[key] ?? fallback;",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback")).toEqual([]);
	});

	it("still flags a status token that masks failed state", async () => {
		const filePath = writeFile(
			"status-token.ts",
			[
				"function check(response: { status?: string }) {",
				"  // failed status fallback",
				"  const status = response.status || 'ok';",
				"  return status;",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectHiddenFallbacks(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hidden-fallback")).toHaveLength(1);
	});
});

describe("redundant type coercion", () => {
	it("detects primitive parameters coerced back to the same primitive", async () => {
		const filePath = writeFile(
			"coerce.ts",
			[
				"function normalize(userId: string, retryCount: number, enabled: boolean) {",
				"  const stableUserId = String(userId);",
				"  const stableRetryCount = Number(retryCount);",
				"  return Boolean(enabled) ? `${stableUserId}:${stableRetryCount}` : stableUserId;",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectDefensivePatterns(makeContext([filePath]));
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/redundant-type-coercion");
		expect(matches).toHaveLength(3);
		expect(matches.map((d) => d.line)).toEqual([2, 3, 4]);
	});

	it("detects redundant coercion inside arrow functions", async () => {
		const filePath = writeFile(
			"arrow.ts",
			[
				"const normalizeEmail = (email: string) => {",
				"  const stableEmail = String(email);",
				"  return stableEmail.toLowerCase();",
				"};",
			].join("\n"),
		);

		const diagnostics = await detectDefensivePatterns(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/redundant-type-coercion")).toHaveLength(1);
	});

	it("does not flag meaningful conversions between different primitive types", async () => {
		const filePath = writeFile(
			"conversion.ts",
			[
				"function normalize(userId: string, count: number) {",
				"  return Number(userId) + String(count);",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectDefensivePatterns(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/redundant-type-coercion")).toEqual([]);
	});

	it("does not flag unknown or union input validation", async () => {
		const filePath = writeFile(
			"unknown.ts",
			[
				"function normalize(input: unknown, id: string | number) {",
				"  return `${String(input)}:${String(id)}`;",
				"}",
			].join("\n"),
		);

		const diagnostics = await detectDefensivePatterns(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/redundant-type-coercion")).toEqual([]);
	});

	it("does not flag non-production examples", async () => {
		const filePath = writeFile(
			"examples/coerce.ts",
			["function normalize(userId: string) {", "  return String(userId);", "}"].join("\n"),
		);

		const diagnostics = await detectDefensivePatterns(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/redundant-type-coercion")).toEqual([]);
	});
});

describe("duplicate type declarations", () => {
	it("detects exported duplicate type declarations with the same shape", async () => {
		const first = writeFile(
			"domain/user.ts",
			["export interface CustomerSnapshot {", "  id: string;", "  email: string;", "}"].join("\n"),
		);
		const second = writeFile(
			"api/user.ts",
			["export interface CustomerSnapshot {", "  id: string;", "  email: string;", "}"].join("\n"),
		);

		const diagnostics = await detectDefensivePatterns(makeContext([first, second]));
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/duplicate-type-declaration");
		expect(matches).toHaveLength(1);
		expect(matches[0].filePath).toBe("api/user.ts");
		expect(matches[0].line).toBe(1);
	});

	it("does not flag duplicate names with different shapes", async () => {
		const first = writeFile(
			"domain/user.ts",
			["export interface CustomerSnapshot {", "  id: string;", "  email: string;", "}"].join("\n"),
		);
		const second = writeFile(
			"api/user.ts",
			["export interface CustomerSnapshot {", "  id: string;", "  name: string;", "}"].join("\n"),
		);

		const diagnostics = await detectDefensivePatterns(makeContext([first, second]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/duplicate-type-declaration")).toEqual([]);
	});

	it("does not flag private local type declarations", async () => {
		const first = writeFile(
			"domain/user.ts",
			["interface CustomerSnapshot {", "  id: string;", "  email: string;", "}"].join("\n"),
		);
		const second = writeFile(
			"api/user.ts",
			["interface CustomerSnapshot {", "  id: string;", "  email: string;", "}"].join("\n"),
		);

		const diagnostics = await detectDefensivePatterns(makeContext([first, second]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/duplicate-type-declaration")).toEqual([]);
	});
});
