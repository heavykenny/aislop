import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixDeadPatterns } from "../src/engines/ai-slop/dead-patterns-fix.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const makeContext = (files: string[]): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["typescript"],
	frameworks: ["none"],
	files,
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 4, maxParams: 6 },
		security: { audit: true, auditTimeout: 25000 },
	},
});

const writeFile = (filename: string, content: string): string => {
	const filePath = path.join(tmpDir, filename);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
};

const readFile = (filename: string): string =>
	fs.readFileSync(path.join(tmpDir, filename), "utf-8");

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-fix-dead-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Single-line console.log removal ─────────────────────────────────────────

describe("fixDeadPatterns — single-line console removal", () => {
	it("removes a single-line console.log", async () => {
		const file = writeFile("app.ts", [
			'export function run() {',
			'    console.log("debug");',
			'    return 1;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.ts");

		expect(result).not.toContain("console.log");
		expect(result).toContain("return 1;");
	});

	it("removes console.debug and console.info", async () => {
		const file = writeFile("app.ts", [
			'export function run() {',
			'    console.debug("dbg");',
			'    console.info("info");',
			'    return 1;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.ts");

		expect(result).not.toContain("console.debug");
		expect(result).not.toContain("console.info");
		expect(result).toContain("return 1;");
	});
});

// ─── Multi-line console.log removal ──────────────────────────────────────────

describe("fixDeadPatterns — multi-line console removal", () => {
	it("removes a multi-line console.log completely", async () => {
		const file = writeFile("app.ts", [
			'export function run() {',
			'    console.log(',
			'        "starting",',
			'        "up",',
			'    );',
			'    return 1;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.ts");

		expect(result).not.toContain("console.log");
		expect(result).not.toContain('"starting"');
		expect(result).not.toContain('"up"');
		expect(result).toContain("return 1;");
	});

	it("does not leave orphaned lines from multi-line removal", async () => {
		const file = writeFile("app.ts", [
			'export function main() {',
			'    console.log(',
			'        "Starting up now",',
			'    );',
			'    return false;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.ts");

		// Entire multi-line statement removed — no orphaned string or paren
		expect(result).not.toContain("console.log");
		expect(result).not.toContain('"Starting up now"');
		expect(result).toContain("return false;");
	});

	it("produces valid JavaScript after multi-line removal", async () => {
		const file = writeFile("app.js", [
			'function setup() {',
			'    const x = 1;',
			'    console.log(',
			'        "value:",',
			'        x,',
			'    );',
			'    return x;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.js");

		// Verify no syntax errors by checking structure is intact
		expect(result).toContain("function setup()");
		expect(result).toContain("const x = 1;");
		expect(result).toContain("return x;");
		expect(result).not.toContain("console.log");
	});
});

// ─── Error message upgrade to console.error ──────────────────────────────────

describe("fixDeadPatterns — console.error upgrade", () => {
	it("upgrades console.log with 'error' to console.error", async () => {
		const file = writeFile("app.ts", [
			'export function run() {',
			'    console.log("Error: connection failed");',
			'    return 1;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.ts");

		expect(result).toContain('console.error("Error: connection failed")');
		expect(result).not.toContain("console.log");
	});

	it("upgrades console.log with 'not found' to console.error", async () => {
		const file = writeFile("app.ts", [
			'export function run() {',
			'    console.log("Config file not found");',
			'    return 1;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.ts");

		expect(result).toContain('console.error("Config file not found")');
	});

	it("upgrades console.log with 'failed' to console.error", async () => {
		const file = writeFile("app.ts", [
			'export function run() {',
			'    console.log("Build failed");',
			'    return 1;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.ts");

		expect(result).toContain('console.error("Build failed")');
	});

	it("upgrades console.log with 'unable' to console.error", async () => {
		const file = writeFile("app.ts", [
			'export function run() {',
			'    console.log("Unable to connect to database");',
			'    return 1;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.ts");

		expect(result).toContain('console.error("Unable to connect to database")');
	});

	it("upgrades multi-line console.log with error message to console.error", async () => {
		const file = writeFile("app.ts", [
			'export function run(id: string) {',
			'    console.log(',
			'        "No booted simulator found. Boot one first.",',
			'    );',
			'    return 1;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.ts");

		expect(result).toContain("console.error(");
		expect(result).toContain("No booted simulator found");
		expect(result).not.toContain("console.log");
	});

	it("preserves all lines of a multi-line error upgrade", async () => {
		const file = writeFile("app.ts", [
			'export function run(id: string) {',
			'    console.log(',
			'        "Unable to find device",',
			'        id,',
			'        "in the list",',
			'    );',
			'    return 1;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.ts");

		expect(result).toContain("console.error(");
		expect(result).toContain('"Unable to find device"');
		expect(result).toContain("id,");
		expect(result).toContain('"in the list"');
	});

	it("does NOT upgrade plain debug console.log to console.error", async () => {
		const file = writeFile("app.ts", [
			'export function run() {',
			'    console.log("Starting setup...");',
			'    console.log("All done!");',
			'    console.log("Debug data:", { x: 1 });',
			'    return 1;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.ts");

		expect(result).not.toContain("console.log");
		expect(result).not.toContain("console.error");
		expect(result).not.toContain("Starting setup");
		expect(result).not.toContain("All done");
		expect(result).not.toContain("Debug data");
	});
});

// ─── Mixed scenarios ─────────────────────────────────────────────────────────

describe("fixDeadPatterns — mixed console handling", () => {
	it("handles mix of removals and upgrades in one file", async () => {
		const file = writeFile("app.ts", [
			'export function setup(udid: string) {',
			'    console.log("Starting setup...");',
			'    if (!udid) {',
			'        console.log("No simulator found");',
			'        process.exit(1);',
			'    }',
			'    console.log("Debug:", { udid });',
			'    console.log("Error: connection failed for", udid);',
			'    console.log("All done!");',
			'    return udid;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.ts");

		// Removed (debug noise)
		expect(result).not.toContain("Starting setup");
		expect(result).not.toContain("Debug:");
		expect(result).not.toContain("All done");

		// Upgraded to console.error (error messages)
		expect(result).toContain('console.error("No simulator found")');
		expect(result).toContain('console.error("Error: connection failed for", udid)');

		// Structure preserved
		expect(result).toContain("process.exit(1)");
		expect(result).toContain("return udid;");
	});

	it("does not touch console.error or console.warn", async () => {
		const file = writeFile("app.ts", [
			'export function run() {',
			'    console.error("This is fine");',
			'    console.warn("This too");',
			'    console.log("Remove me");',
			'    return 1;',
			'}',
		].join("\n"));

		await fixDeadPatterns(makeContext([file]));
		const result = readFile("app.ts");

		expect(result).toContain('console.error("This is fine")');
		expect(result).toContain('console.warn("This too")');
		expect(result).not.toContain("Remove me");
	});
});
