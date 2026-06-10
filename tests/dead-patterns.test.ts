import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDeadPatterns } from "../src/engines/ai-slop/dead-patterns.js";
import { detectHardcodedConfigLiterals } from "../src/engines/ai-slop/hardcoded-config.js";
import { detectUnusedImports } from "../src/engines/ai-slop/unused-imports.js";
import type { EngineContext } from "../src/engines/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-dead-patterns-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Unused Imports ──────────────────────────────────────────────────────────

describe("unused imports", () => {
	it("does not flag `from __future__ import` (a parser directive, not a name)", async () => {
		const filePath = writeFile("future.py", "from __future__ import annotations\n\nx: int = 1\n");
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/unused-import")).toEqual([]);
	});

	it("detects an unused named import", async () => {
		const filePath = writeFile(
			"unused.ts",
			['import { foo, bar } from "./module";', "const x = foo();"].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter((d) => d.rule === "ai-slop/unused-import");
		expect(unused.length).toBe(1);
		expect(unused[0].message).toContain("bar");
	});

	it("does not flag used imports", async () => {
		const filePath = writeFile(
			"used.ts",
			[
				'import { readFileSync } from "node:fs";',
				"const data = readFileSync('file.txt', 'utf-8');",
			].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter((d) => d.rule === "ai-slop/unused-import");
		expect(unused).toHaveLength(0);
	});

	it("does not flag side-effect imports", async () => {
		const filePath = writeFile("sideeffect.ts", 'import "./polyfill";');
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter((d) => d.rule === "ai-slop/unused-import");
		expect(unused).toHaveLength(0);
	});

	it("does not flag type-only imports", async () => {
		const filePath = writeFile(
			"typeonly.ts",
			['import type { SomeType } from "./types";', "const x = 1;"].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter((d) => d.rule === "ai-slop/unused-import");
		expect(unused).toHaveLength(0);
	});

	it("detects unused default import", async () => {
		const filePath = writeFile(
			"default.ts",
			['import React from "react";', "const x = 1;"].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter((d) => d.rule === "ai-slop/unused-import");
		expect(unused.length).toBe(1);
		expect(unused[0].message).toContain("React");
	});

	it("detects unused namespace import", async () => {
		const filePath = writeFile(
			"namespace.ts",
			['import * as utils from "./utils";', "const x = 1;"].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter((d) => d.rule === "ai-slop/unused-import");
		expect(unused.length).toBe(1);
		expect(unused[0].message).toContain("utils");
	});

	it("detects unused Python imports", async () => {
		const filePath = writeFile(
			"unused.py",
			["from os import path, getcwd", "print(path.join('a', 'b'))"].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter((d) => d.rule === "ai-slop/unused-import");
		expect(unused.length).toBe(1);
		expect(unused[0].message).toContain("getcwd");
	});

	it("marks unused import diagnostics as fixable", async () => {
		const filePath = writeFile(
			"fixable.ts",
			['import { unused } from "./mod";', "const x = 1;"].join("\n"),
		);
		const diagnostics = await detectUnusedImports(makeContext([filePath]));
		const unused = diagnostics.filter((d) => d.rule === "ai-slop/unused-import");
		expect(unused.length).toBe(1);
		expect(unused[0].fixable).toBe(true);
	});
});

// ─── Console Leftovers ───────────────────────────────────────────────────────

describe("console leftovers", () => {
	it("detects console.log in TypeScript files", async () => {
		const filePath = writeFile(
			"debug.ts",
			[
				"function process(data: string) {",
				"  console.log(data);",
				"  return data.trim();",
				"}",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD.length).toBe(1);
		expect(consoleD[0].line).toBe(2);
	});

	it("detects console.debug and console.info", async () => {
		const filePath = writeFile(
			"debug2.ts",
			["console.debug('debugging');", "console.info('info message');"].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD.length).toBe(2);
	});

	it("does not flag console.error and console.warn", async () => {
		const filePath = writeFile(
			"errors.ts",
			["console.error('critical');", "console.warn('warning');"].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(0);
	});

	it("does not flag commented console.log", async () => {
		const filePath = writeFile("commented.ts", "// console.log('disabled');");
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(0);
	});

	it("does not flag console in .py files", async () => {
		const filePath = writeFile("notjs.py", "console.log('not real');");
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(0);
	});

	it("does not flag console in examples/", async () => {
		const filePath = writeFile("examples/rainbow.js", "console.log('hello');");
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(0);
	});

	it("does not flag console in bench/benches/benchmarks", async () => {
		const a = writeFile("packages/bench/index.ts", "console.log('bench');");
		const b = writeFile("benches/timing.ts", "console.log('bench');");
		const c = writeFile("benchmarks/run.ts", "console.log('bench');");
		const diagnostics = await detectDeadPatterns(makeContext([a, b, c]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(0);
	});

	it("does not flag console in CLI command sources (cli/, packages/cli/, my-cli/)", async () => {
		const a = writeFile("packages/cli/src/Generate.ts", "console.log('hello');");
		const b = writeFile("apps/cli/index.ts", "console.log('hello');");
		const c = writeFile("my-cli/src/index.ts", "console.log('hello');");
		const diagnostics = await detectDeadPatterns(makeContext([a, b, c]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(0);
	});

	it("does not flag console in CLI entrypoint files or bin/scripts folders", async () => {
		const files = [
			writeFile("src/cli.ts", "console.log('usage');"),
			writeFile("bin/run.ts", "console.log('running');"),
			writeFile("scripts/generate.ts", "console.log('generated');"),
		];
		const diagnostics = await detectDeadPatterns(makeContext(files));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(0);
	});

	it("does not flag console in root-level scripts named benchmark-* / seed-* / smoke-* / etc.", async () => {
		const files = [
			writeFile("benchmark-railway.js", "console.log('running');"),
			writeFile("bench-cobalt.mjs", "console.log('running');"),
			writeFile("seed-db.ts", "console.log('seeding');"),
			writeFile("smoke-test.js", "console.log('hello');"),
			writeFile("api-benchmark.js", "console.log('suffix form');"),
		];
		const diagnostics = await detectDeadPatterns(makeContext(files));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(0);
	});

	it("still flags console in regular root-level production files", async () => {
		const filePath = writeFile("server.js", "console.log('production code');");
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(1);
	});

	it("does not flag console in fixtures/ or demos/", async () => {
		const a = writeFile("__fixtures__/sample.js", "console.log('fixture');");
		const b = writeFile("demo/walkthrough.ts", "console.log('demo');");
		const diagnostics = await detectDeadPatterns(makeContext([a, b]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(0);
	});

	it("does not flag console output in prototype scripts", async () => {
		const filePath = writeFile(
			"design/prototype.ts",
			[
				"async function main() {",
				"  console.log('Prototype validation');",
				"  console.log(`Output: ${process.cwd()}`);",
				"}",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(0);
	});

	it("does not flag command-output console in guarded entrypoints", async () => {
		const filePath = writeFile(
			"src/find-tool.ts",
			[
				"function main() {",
				"  const bin = locateBinary();",
				"  console.log(bin);",
				"}",
				"if (import.meta.main) main();",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(0);
	});

	it("does not treat process.argv usage alone as a console-output entrypoint", async () => {
		const filePath = writeFile(
			"src/options.ts",
			[
				"export function parse() {",
				"  const mode = process.argv[2];",
				"  console.log(mode);",
				"}",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(1);
	});

	it("does not flag bracket-prefixed operational logs", async () => {
		const filePath = writeFile(
			"server.ts",
			[
				"export function start(port: number) {",
				"  console.log(`[server] listening on ${port}`);",
				"  console.info('[server] ready');",
				"}",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const consoleD = diagnostics.filter((d) => d.rule === "ai-slop/console-leftover");
		expect(consoleD).toHaveLength(0);
	});
});

// ─── TODO Stubs ──────────────────────────────────────────────────────────────

describe("todo stubs", () => {
	it("detects TODO comments", async () => {
		const filePath = writeFile(
			"todos.ts",
			["// TODO: implement this properly", "function placeholder() { return null; }"].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const todos = diagnostics.filter((d) => d.rule === "ai-slop/todo-stub");
		expect(todos.length).toBe(1);
		expect(todos[0].severity).toBe("info");
	});

	it("detects FIXME comments", async () => {
		const filePath = writeFile("fixme.ts", "// FIXME: this is broken");
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const todos = diagnostics.filter((d) => d.rule === "ai-slop/todo-stub");
		expect(todos.length).toBe(1);
	});

	it("detects HACK comments", async () => {
		const filePath = writeFile("hack.ts", "// HACK: temporary workaround");
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const todos = diagnostics.filter((d) => d.rule === "ai-slop/todo-stub");
		expect(todos.length).toBe(1);
	});

	it("detects Python TODO comments", async () => {
		const filePath = writeFile("todos.py", "# TODO: add validation");
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const todos = diagnostics.filter((d) => d.rule === "ai-slop/todo-stub");
		expect(todos.length).toBe(1);
	});

	it("does not flag non-comment TODO mentions", async () => {
		const filePath = writeFile("notcomment.ts", 'const message = "TODO: fix this";');
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const todos = diagnostics.filter((d) => d.rule === "ai-slop/todo-stub");
		expect(todos).toHaveLength(0);
	});
});

describe("empty functions", () => {
	it("detects empty function stubs", async () => {
		const filePath = writeFile("empty-function.ts", "export function placeholder() {}");
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/empty-function");
		expect(matches).toHaveLength(1);
		expect(matches[0].severity).toBe("info");
	});

	it("does not flag property-assigned no-op shims", async () => {
		const filePath = writeFile(
			"browser-shim.ts",
			["const plugins = [];", "plugins.refresh = () => {};"].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/empty-function");
		expect(matches).toHaveLength(0);
	});
});

// ─── Hardcoded Config Literals ───────────────────────────────────────────────

describe("hardcoded config literals", () => {
	it("detects hardcoded environment URLs in production code", async () => {
		const filePath = writeFile(
			"client.ts",
			[
				'const API_BASE_URL = "https://api.acme.com/v1";',
				"export const fetchUser = (id: string) => fetch(`${API_BASE_URL}/users/${id}`);",
			].join("\n"),
		);
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-url");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(1);
	});

	it("does not flag URLs that are already env-backed", async () => {
		const filePath = writeFile(
			"client-env.ts",
			'const API_BASE_URL = process.env.API_BASE_URL ?? "https://api.acme.com/v1";',
		);
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-url")).toEqual([]);
	});

	it("does not flag localhost / loopback URLs (dev defaults)", async () => {
		const filePath = writeFile(
			"dev-config.ts",
			[
				'const origin = optional("CORS_ORIGIN", "http://localhost:5173");',
				'const proxyTarget = "http://127.0.0.1:3001";',
			].join("\n"),
		);
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-url")).toEqual([]);
	});

	it("does not flag URL constructor parsing probes", async () => {
		const filePath = writeFile("url-parse.ts", "const probe = new URL(`http://${hostname}`);");
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-url")).toEqual([]);
	});

	it("does not flag stable third-party vendor API hosts", async () => {
		const filePath = writeFile(
			"github.ts",
			[
				'const res = await fetch("https://api.github.com/user");',
				'const orgs = await fetch("https://api.github.com/user/orgs");',
				'res.redirect("https://github.com/login/oauth/authorize");',
			].join("\n"),
		);
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-url")).toEqual([]);
	});

	it("still flags a deployment/own environment URL", async () => {
		const filePath = writeFile("redirect.ts", 'res.redirect(301, "https://app.acme-prod.com");');
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-url")).toHaveLength(1);
	});

	it("reports canonical public app URL fallbacks as config signals", async () => {
		const filePath = writeFile(
			"app-url.ts",
			[
				'const CANONICAL = "https://app.scanaislop.com";',
				"",
				"export const resolveAppUrl = (candidate?: string | null): string => {",
				"\tconst value = candidate?.trim();",
				'\treturn value ? value.replace(/\\/$/, "") : CANONICAL;',
				"};",
			].join("\n"),
		);
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-url")).toHaveLength(1);
	});

	it("does not flag documentation links", async () => {
		const filePath = writeFile(
			"docs-link.ts",
			'const docsUrl = "https://scanaislop.com/patterns";',
		);
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-url")).toEqual([]);
	});

	it("does not flag hardcoded URLs in non-production examples", async () => {
		const filePath = writeFile(
			"examples/demo.ts",
			'const API_BASE_URL = "https://api.acme.com/v1";',
		);
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-url")).toEqual([]);
	});

	it("detects hardcoded provider IDs in production code", async () => {
		const filePath = writeFile("billing.ts", 'const STRIPE_PRICE_ID = "price_123456789abcdef";');
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-id");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(1);
	});

	it("does not flag provider IDs that are already env-backed", async () => {
		const filePath = writeFile(
			"billing-env.ts",
			'const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? "price_123456789abcdef";',
		);
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-id")).toEqual([]);
	});

	it("does not flag env-var-name literals passed to a config helper", async () => {
		const filePath = writeFile(
			"config.ts",
			[
				'const github = { clientId: optional("GITHUB_CLIENT_ID", "") };',
				'const stripe = { priceProMonthly: optional("STRIPE_PRICE_PRO_MONTHLY", "") };',
			].join("\n"),
		);
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-id")).toEqual([]);
	});

	it("still flags a real provider ID even on a SCREAMING_SNAKE-named const", async () => {
		const filePath = writeFile("real-id.ts", 'const STRIPE_PRICE_ID = "price_1OabcdEFghijKLmn";');
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-id")).toHaveLength(1);
	});

	it("does not flag readable kebab/snake slugs and storage keys", async () => {
		const filePath = writeFile(
			"slugs.ts",
			[
				'const STORAGE_KEY = "scanaislop_theme";',
				'const entry = { key: "swallowed-exception" };',
				'const map = { "hardcoded-secret": ["security/hardcoded-secret"] };',
			].join("\n"),
		);
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-id")).toEqual([]);
	});

	it("does not flag stable schema/keychain constants as provider IDs", async () => {
		const filePath = writeFile(
			"keychain.ts",
			[
				"const attempts = [",
				"  ['secret-tool', 'lookup', 'xdg:schema', 'chrome_libsecret_os_crypt_password_v2'],",
				"];",
			].join("\n"),
		);
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-id")).toEqual([]);
	});

	it("does not flag hardcoded IDs in DB migration files", async () => {
		const filePath = writeFile(
			"packages/api/src/db/migrations/0001-indexes.ts",
			'export const up = () => createIndex("idx_scans_org_created_at_desc", "price_123456789abcdef");',
		);
		const diagnostics = await detectHardcodedConfigLiterals(makeContext([filePath]));
		expect(diagnostics.filter((d) => d.rule === "ai-slop/hardcoded-id")).toEqual([]);
	});
});

// ─── Dead Code Patterns ──────────────────────────────────────────────────────

describe("dead code patterns", () => {
	it("detects code after return statement", async () => {
		const filePath = writeFile(
			"unreachable.ts",
			["function test() {", "  return 42;", "  const x = 1;", "}"].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const unreachable = diagnostics.filter((d) => d.rule === "ai-slop/unreachable-code");
		expect(unreachable.length).toBe(1);
		expect(unreachable[0].line).toBe(3);
	});

	it("does not flag closing brace after return", async () => {
		const filePath = writeFile(
			"ok-return.ts",
			["function test() {", "  return 42;", "}"].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const unreachable = diagnostics.filter((d) => d.rule === "ai-slop/unreachable-code");
		expect(unreachable).toHaveLength(0);
	});

	it("does not flag the closure terminator after a return inside an arrow callback", async () => {
		const filePath = writeFile(
			"closure-return.ts",
			[
				"const getValue = () => {",
				"  if (kind === 'a') return first;",
				"  if (kind === 'b') return second;",
				"  return undefined;",
				"};",
				"const value = getValue();",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const unreachable = diagnostics.filter((d) => d.rule === "ai-slop/unreachable-code");
		expect(unreachable).toHaveLength(0);
	});

	it("does not treat one-line guarded returns as unconditional exits", async () => {
		const filePath = writeFile(
			"guarded-return.ts",
			[
				"function pick(kind: string) {",
				"  if (kind === 'a')",
				"    return first;",
				"  if (kind === 'b') return second;",
				"  const fallback = computeFallback();",
				"  return fallback;",
				"}",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const unreachable = diagnostics.filter((d) => d.rule === "ai-slop/unreachable-code");
		expect(unreachable).toHaveLength(0);
	});

	it("does not treat exits after multiline guard conditions as unconditional", async () => {
		const filePath = writeFile(
			"multiline-guard.ts",
			[
				"function parse(resp: { body: unknown }) {",
				"  if (",
				'    typeof resp.body === "object" &&',
				"    resp.body &&",
				'    "message" in resp.body',
				"  )",
				"    throw resp.body.message;",
				"  throw new Error(String(resp.body));",
				"}",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const unreachable = diagnostics.filter((d) => d.rule === "ai-slop/unreachable-code");
		expect(unreachable).toHaveLength(0);
	});

	it("does not stop multiline guard detection at object literals inside conditions", async () => {
		const filePath = writeFile(
			"object-guard.ts",
			[
				"async function open(confirm: (message: string, options: unknown) => Promise<boolean>) {",
				"  if (",
				"    !(await confirm(",
				'      "Open item?",',
				"      {",
				'        title: "Needs review",',
				'        kind: "warning",',
				"      },",
				"    ))",
				"  )",
				"    return;",
				"  openEditor();",
				"}",
			].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const unreachable = diagnostics.filter((d) => d.rule === "ai-slop/unreachable-code");
		expect(unreachable).toHaveLength(0);
	});

	it("detects constant condition if (false)", async () => {
		const filePath = writeFile("constant.ts", ["if (false) {", "  doSomething();", "}"].join("\n"));
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const constant = diagnostics.filter((d) => d.rule === "ai-slop/constant-condition");
		expect(constant.length).toBe(1);
	});

	it("detects constant condition if (true)", async () => {
		const filePath = writeFile("alwaystrue.ts", "if (true) { run(); }");
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const constant = diagnostics.filter((d) => d.rule === "ai-slop/constant-condition");
		expect(constant.length).toBe(1);
	});
});

// ─── Unsafe Type Assertions ──────────────────────────────────────────────────

describe("unsafe type assertions", () => {
	it("detects 'as any' in TypeScript", async () => {
		const filePath = writeFile("unsafe.ts", "const data = response.body as any;");
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const asAny = diagnostics.filter((d) => d.rule === "ai-slop/unsafe-type-assertion");
		expect(asAny.length).toBe(1);
	});

	it("detects double assertion 'as unknown as'", async () => {
		const filePath = writeFile("double.ts", "const x = value as unknown as SpecificType;");
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const doubleAssert = diagnostics.filter((d) => d.rule === "ai-slop/double-type-assertion");
		expect(doubleAssert.length).toBe(1);
	});

	it("detects @ts-ignore directive", async () => {
		const filePath = writeFile(
			"ignore.ts",
			["// @ts-ignore", "const x: number = 'not a number';"].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const directives = diagnostics.filter((d) => d.rule === "ai-slop/ts-directive");
		expect(directives.length).toBe(1);
	});

	it("detects @ts-expect-error directive", async () => {
		const filePath = writeFile(
			"expect-error.ts",
			["// @ts-expect-error", "const x: number = 'not a number';"].join("\n"),
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const directives = diagnostics.filter((d) => d.rule === "ai-slop/ts-directive");
		expect(directives.length).toBe(1);
	});

	it("does not flag 'as any' in .js files", async () => {
		const filePath = writeFile("nocheck.js", "const data = response.body as any;");
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const asAny = diagnostics.filter((d) => d.rule === "ai-slop/unsafe-type-assertion");
		expect(asAny).toHaveLength(0);
	});

	it("does not flag commented 'as any'", async () => {
		const filePath = writeFile("commented.ts", "// const data = response.body as any;");
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const asAny = diagnostics.filter((d) => d.rule === "ai-slop/unsafe-type-assertion");
		expect(asAny).toHaveLength(0);
	});

	it("does not flag 'as any' in benchmarks", async () => {
		const filePath = writeFile(
			"packages/bench/benchUtil.ts",
			"export const x = factory(zod3 as any) as T;",
		);
		const diagnostics = await detectDeadPatterns(makeContext([filePath]));
		const asAny = diagnostics.filter((d) => d.rule === "ai-slop/unsafe-type-assertion");
		expect(asAny).toHaveLength(0);
	});

	it("does not flag 'as unknown as' in fixtures or examples", async () => {
		const a = writeFile("examples/sample.ts", "const x = value as unknown as SpecificType;");
		const b = writeFile("__fixtures__/data.ts", "const y = thing as unknown as Other;");
		const diagnostics = await detectDeadPatterns(makeContext([a, b]));
		const doubleAssert = diagnostics.filter((d) => d.rule === "ai-slop/double-type-assertion");
		expect(doubleAssert).toHaveLength(0);
	});
});

// ─── General ──────────────────────────────────────────────────────────────────

describe("general", () => {
	it("returns empty array when files list is empty", async () => {
		const diagnostics = await detectDeadPatterns(makeContext([]));
		expect(diagnostics).toHaveLength(0);
	});

	it("all diagnostics have engine ai-slop", async () => {
		const filePath = writeFile(
			"mixed.ts",
			[
				'import { unused } from "./mod";',
				"// TODO: fix this",
				"console.log('debug');",
				"const x = value as any;",
			].join("\n"),
		);
		const ctx = makeContext([filePath]);
		const diagnostics = [...(await detectDeadPatterns(ctx)), ...(await detectUnusedImports(ctx))];
		for (const d of diagnostics) {
			expect(d.engine).toBe("ai-slop");
		}
	});

	it("all diagnostics have category AI Slop", async () => {
		const filePath = writeFile(
			"mixed2.ts",
			['import { unused } from "./mod";', "// FIXME: broken", "console.log('test');"].join("\n"),
		);
		const ctx = makeContext([filePath]);
		const diagnostics = [...(await detectDeadPatterns(ctx)), ...(await detectUnusedImports(ctx))];
		for (const d of diagnostics) {
			expect(d.category).toBe("AI Slop");
		}
	});

	it("reports relative file paths", async () => {
		const filePath = writeFile("subdir/test.ts", 'import { unused } from "./mod";');
		const ctx = makeContext([filePath]);
		const diagnostics = [...(await detectDeadPatterns(ctx)), ...(await detectUnusedImports(ctx))];
		for (const d of diagnostics) {
			expect(path.isAbsolute(d.filePath)).toBe(false);
		}
	});
});
