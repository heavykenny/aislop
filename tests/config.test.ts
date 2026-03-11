import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import {
	CONFIG_DIR,
	CONFIG_FILE,
	findConfigDir,
	loadConfig,
} from "../src/config/index.js";
import { parseConfig } from "../src/config/schema.js";

// ─── parseConfig ──────────────────────────────────────────────────────────────

describe("parseConfig", () => {
	it("returns defaults when called with null", () => {
		const result = parseConfig(null);
		expect(result).toEqual(DEFAULT_CONFIG);
	});

	it("returns defaults when called with undefined", () => {
		const result = parseConfig(undefined);
		expect(result).toEqual(DEFAULT_CONFIG);
	});

	it("returns defaults when called with a non-object primitive", () => {
		expect(parseConfig("string")).toEqual(DEFAULT_CONFIG);
		expect(parseConfig(42)).toEqual(DEFAULT_CONFIG);
		expect(parseConfig(true)).toEqual(DEFAULT_CONFIG);
	});

	it("returns defaults when called with an empty object", () => {
		const result = parseConfig({});
		expect(result).toEqual(DEFAULT_CONFIG);
	});

	it("deep-merges a partial override — only quality.maxFunctionLoc changes", () => {
		const result = parseConfig({ quality: { maxFunctionLoc: 50 } });
		expect(result.quality.maxFunctionLoc).toBe(50);
		// Other quality fields keep their defaults
		expect(result.quality.maxFileLoc).toBe(DEFAULT_CONFIG.quality.maxFileLoc);
		expect(result.quality.maxNesting).toBe(DEFAULT_CONFIG.quality.maxNesting);
		expect(result.quality.maxParams).toBe(DEFAULT_CONFIG.quality.maxParams);
	});

	it("overrides multiple nested sections independently", () => {
		const result = parseConfig({
			quality: { maxFunctionLoc: 30, maxFileLoc: 200 },
			security: { audit: false },
		});
		expect(result.quality.maxFunctionLoc).toBe(30);
		expect(result.quality.maxFileLoc).toBe(200);
		expect(result.security.audit).toBe(false);
		// Untouched values stay at defaults
		expect(result.security.auditTimeout).toBe(
			DEFAULT_CONFIG.security.auditTimeout,
		);
	});

	it("falls back to defaults when ci.format is an invalid value", () => {
		const result = parseConfig({ ci: { format: "sarif" } });
		// "sarif" is not a valid format, so zod validation falls back to defaults
		expect(result.ci.format).toBe("json");
		expect(result.ci.failBelow).toBe(DEFAULT_CONFIG.ci.failBelow);
	});

	it("overrides engine toggles", () => {
		const result = parseConfig({
			engines: { "ai-slop": false, architecture: true },
		});
		expect(result.engines["ai-slop"]).toBe(false);
		expect(result.engines.architecture).toBe(true);
		// Untouched engines stay at defaults
		expect(result.engines.format).toBe(DEFAULT_CONFIG.engines.format);
		expect(result.engines.lint).toBe(DEFAULT_CONFIG.engines.lint);
	});

	it("overrides scoring weights partially", () => {
		const result = parseConfig({
			scoring: { weights: { security: 3.0 } },
		});
		expect(result.scoring.weights.security).toBe(3.0);
		// Other weights keep defaults
		expect(result.scoring.weights.format).toBe(
			DEFAULT_CONFIG.scoring.weights.format,
		);
	});

	it("overrides scoring thresholds", () => {
		const result = parseConfig({
			scoring: { thresholds: { good: 90, ok: 60 } },
		});
		expect(result.scoring.thresholds.good).toBe(90);
		expect(result.scoring.thresholds.ok).toBe(60);
	});

	it("preserves version when specified", () => {
		const result = parseConfig({ version: 2 });
		expect(result.version).toBe(2);
	});
});

// ─── DEFAULT_CONFIG ────────────────────────────────────────────────────────────

describe("DEFAULT_CONFIG", () => {
	it("has version 1", () => {
		expect(DEFAULT_CONFIG.version).toBe(1);
	});

	it("has all engines defined", () => {
		const engines = DEFAULT_CONFIG.engines;
		expect(engines.format).toBe(true);
		expect(engines.lint).toBe(true);
		expect(engines["code-quality"]).toBe(true);
		expect(engines["ai-slop"]).toBe(true);
		expect(engines.architecture).toBe(false); // disabled by default
		expect(engines.security).toBe(true);
	});

	it("has sensible quality limits", () => {
		expect(DEFAULT_CONFIG.quality.maxFunctionLoc).toBeGreaterThan(0);
		expect(DEFAULT_CONFIG.quality.maxFileLoc).toBeGreaterThan(0);
		expect(DEFAULT_CONFIG.quality.maxNesting).toBeGreaterThan(0);
		expect(DEFAULT_CONFIG.quality.maxParams).toBeGreaterThan(0);
	});

	it("has scoring weights for all engines", () => {
		const weights = DEFAULT_CONFIG.scoring.weights;
		expect(weights.format).toBeDefined();
		expect(weights.lint).toBeDefined();
		expect(weights["code-quality"]).toBeDefined();
		expect(weights["ai-slop"]).toBeDefined();
		expect(weights.security).toBeDefined();
	});

	it("security has higher weight than format", () => {
		expect(DEFAULT_CONFIG.scoring.weights.security).toBeGreaterThan(
			DEFAULT_CONFIG.scoring.weights.format,
		);
	});

	it("thresholds are ordered: ok < good", () => {
		expect(DEFAULT_CONFIG.scoring.thresholds.ok).toBeLessThan(
			DEFAULT_CONFIG.scoring.thresholds.good,
		);
	});

	it("ci format is json by default", () => {
		expect(DEFAULT_CONFIG.ci.format).toBe("json");
	});

	it("ci failBelow defaults to 0", () => {
		expect(DEFAULT_CONFIG.ci.failBelow).toBe(0);
	});
});

// ─── loadConfig / findConfigDir ────────────────────────────────────────────────

describe("findConfigDir", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "slop-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null when no .slop directory exists", () => {
		const result = findConfigDir(tmpDir);
		expect(result).toBeNull();
	});

	it("finds .slop in the given directory", () => {
		const slopDir = path.join(tmpDir, CONFIG_DIR);
		fs.mkdirSync(slopDir);
		const result = findConfigDir(tmpDir);
		expect(result).toBe(slopDir);
	});

	it("finds .slop in a parent directory", () => {
		const slopDir = path.join(tmpDir, CONFIG_DIR);
		fs.mkdirSync(slopDir);
		const nestedDir = path.join(tmpDir, "src", "lib");
		fs.mkdirSync(nestedDir, { recursive: true });
		const result = findConfigDir(nestedDir);
		expect(result).toBe(slopDir);
	});

	it("does not match a file named .slop (must be a directory)", () => {
		// create a file named .slop instead of a directory
		fs.writeFileSync(path.join(tmpDir, CONFIG_DIR), "not a dir");
		const result = findConfigDir(tmpDir);
		expect(result).toBeNull();
	});
});

describe("loadConfig", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "slop-config-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns DEFAULT_CONFIG when no .slop directory exists", () => {
		const result = loadConfig(tmpDir);
		expect(result).toEqual(DEFAULT_CONFIG);
	});

	it("returns DEFAULT_CONFIG when .slop dir exists but config.yml is absent", () => {
		fs.mkdirSync(path.join(tmpDir, CONFIG_DIR));
		const result = loadConfig(tmpDir);
		expect(result).toEqual(DEFAULT_CONFIG);
	});

	it("loads and merges a valid config.yml", () => {
		const slopDir = path.join(tmpDir, CONFIG_DIR);
		fs.mkdirSync(slopDir);
		fs.writeFileSync(
			path.join(slopDir, CONFIG_FILE),
			"quality:\n  maxFunctionLoc: 40\n",
			"utf-8",
		);
		const result = loadConfig(tmpDir);
		expect(result.quality.maxFunctionLoc).toBe(40);
		// Defaults preserved for other fields
		expect(result.quality.maxFileLoc).toBe(DEFAULT_CONFIG.quality.maxFileLoc);
	});

	it("returns DEFAULT_CONFIG when config.yml contains invalid YAML", () => {
		const slopDir = path.join(tmpDir, CONFIG_DIR);
		fs.mkdirSync(slopDir);
		fs.writeFileSync(
			path.join(slopDir, CONFIG_FILE),
			"{ invalid yaml: [",
			"utf-8",
		);
		const result = loadConfig(tmpDir);
		expect(result).toEqual(DEFAULT_CONFIG);
	});

	it("returns DEFAULT_CONFIG when config.yml is empty", () => {
		const slopDir = path.join(tmpDir, CONFIG_DIR);
		fs.mkdirSync(slopDir);
		fs.writeFileSync(path.join(slopDir, CONFIG_FILE), "", "utf-8");
		const result = loadConfig(tmpDir);
		expect(result).toEqual(DEFAULT_CONFIG);
	});

	it("loads ci override from config.yml", () => {
		const slopDir = path.join(tmpDir, CONFIG_DIR);
		fs.mkdirSync(slopDir);
		fs.writeFileSync(
			path.join(slopDir, CONFIG_FILE),
			"ci:\n  format: json\n  failBelow: 70\n",
			"utf-8",
		);
		const result = loadConfig(tmpDir);
		expect(result.ci.format).toBe("json");
		expect(result.ci.failBelow).toBe(70);
	});
});
