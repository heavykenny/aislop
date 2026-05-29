import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDefensivePatterns } from "../src/engines/ai-slop/defensive-patterns.js";
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
