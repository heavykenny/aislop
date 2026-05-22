import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectRustPatterns } from "../src/engines/ai-slop/rust-patterns.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const buildContext = (): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["rust"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-rust-patterns-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("rust: non-test-unwrap", () => {
	it("flags `.unwrap()` in regular library code", async () => {
		writeFile(
			"src/lib.rs",
			["pub fn read_port(s: &str) -> u16 {", "    s.parse::<u16>().unwrap()", "}", ""].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/rust-non-test-unwrap");
		expect(matches).toHaveLength(1);
	});

	it("does NOT flag `.unwrap()` inside a `#[cfg(test)] mod tests {}` block", async () => {
		writeFile(
			"src/lib.rs",
			[
				"pub fn ok() -> i32 { 1 }",
				"",
				"#[cfg(test)]",
				"mod tests {",
				"    use super::*;",
				"    #[test]",
				"    fn it_works() {",
				"        let v: Result<i32, _> = Ok(1);",
				"        assert_eq!(v.unwrap(), 1);",
				"    }",
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/rust-non-test-unwrap");
		expect(matches).toEqual([]);
	});

	it("does NOT flag `.unwrap()` inside files under tests/ directory", async () => {
		writeFile(
			"tests/integration.rs",
			[
				"#[test]",
				"fn full_path_unwrap() {",
				"    let v: Result<i32, _> = Ok(1);",
				"    assert_eq!(v.unwrap(), 1);",
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/rust-non-test-unwrap");
		expect(matches).toEqual([]);
	});

	it("does NOT flag `.unwrap()` preceded by an intent comment (// safe: ...)", async () => {
		writeFile(
			"src/lib.rs",
			[
				"pub fn parse_known_good(s: &str) -> u16 {",
				"    // safe: caller guarantees the input is a valid u16",
				"    s.parse::<u16>().unwrap()",
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/rust-non-test-unwrap");
		expect(matches).toEqual([]);
	});

	it("does NOT flag `.unwrap()` in build.rs (Cargo build script — runs at build time)", async () => {
		writeFile(
			"build.rs",
			[
				"use std::env;",
				"fn main() {",
				'    let out_dir = env::var_os("OUT_DIR").unwrap();',
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("does NOT flag `.unwrap()` in testutil.rs / test_util.rs / test_utils.rs", async () => {
		writeFile(
			"crates/searcher/src/testutil.rs",
			["pub fn helper() -> i32 {", "    Some(1).unwrap()", "}", ""].join("\n"),
		);
		writeFile("crates/lib/src/test_util.rs", ["pub fn h() { Some(1).unwrap(); }", ""].join("\n"));
		writeFile("crates/lib/src/test_utils.rs", ["pub fn h() { Some(1).unwrap(); }", ""].join("\n"));
		const diagnostics = await detectRustPatterns(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("does NOT flag `writeln!(out, ...).unwrap()` / `write!(out, ...).unwrap()` (infallible String/Vec writers)", async () => {
		writeFile(
			"src/render.rs",
			[
				"use std::fmt::Write;",
				"pub fn render() -> String {",
				"    let mut out = String::new();",
				'    writeln!(out, "hello").unwrap();',
				'    write!(out, "{}", 42).unwrap();',
				"    out",
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/rust-non-test-unwrap");
		expect(matches).toEqual([]);
	});

	it("does NOT flag `.unwrap()` or `todo!()` in files under benches/ (Rust benchmarks)", async () => {
		writeFile(
			"benches/bench.rs",
			[
				"fn main() {",
				"    let v = Some(1);",
				"    let x = v.unwrap();",
				'    todo!("add more cases");',
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("does NOT flag `.unwrap()` or `todo!()` in files under examples/", async () => {
		writeFile(
			"examples/find.rs",
			[
				"fn main() {",
				"    let arg: u16 = std::env::args().nth(1).unwrap().parse().unwrap();",
				'    todo!("reader extends this");',
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("does NOT flag `.unwrap()` in test-helper crate dirs", async () => {
		// Cargo workspace crates named `*-test`, `*-tests`, `tests-*` are test infrastructure.
		writeFile(
			"tokio-test/src/io.rs",
			["pub fn helper() {", "    self.tx.send(x).unwrap();", "}", ""].join("\n"),
		);
		writeFile(
			"tests-integration/src/bin/test-cat.rs",
			["fn main() {", "    let v = Some(1).unwrap();", "}", ""].join("\n"),
		);
		writeFile(
			"crates/foo-test-utils/src/lib.rs",
			["pub fn helper() {", "    Some(1).unwrap();", "}", ""].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/rust-non-test-unwrap");
		expect(matches).toEqual([]);
	});

	it("does NOT flag `.unwrap()` mentioned only inside a comment", async () => {
		writeFile(
			"src/lib.rs",
			[
				"pub fn ok() -> i32 {",
				"    // Avoid .unwrap() — propagate with `?`.",
				"    1",
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		expect(diagnostics).toEqual([]);
	});
});

describe("rust: todo-stub", () => {
	it("flags `todo!()` in any rust file", async () => {
		writeFile("src/lib.rs", ["pub fn unfinished() -> i32 {", "    todo!()", "}", ""].join("\n"));
		const diagnostics = await detectRustPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/rust-todo-stub");
		expect(matches).toHaveLength(1);
	});

	it("flags `unimplemented!()` too", async () => {
		writeFile(
			"src/lib.rs",
			["pub fn nope() -> i32 {", '    unimplemented!("later")', "}", ""].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/rust-todo-stub");
		expect(matches).toHaveLength(1);
	});

	it("flags `todo!()` even inside a `#[cfg(test)]` block (still a bug)", async () => {
		// `todo!()` panics at runtime — leaving it inside a test block is just as much
		// of a stub as leaving it in production code. unwrap is the rule with the test-aware
		// exemption; todo-stub flags everywhere.
		writeFile(
			"src/lib.rs",
			[
				"pub fn ok() -> i32 { 1 }",
				"",
				"#[cfg(test)]",
				"mod tests {",
				"    #[test]",
				"    fn unfinished() {",
				"        todo!()",
				"    }",
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/rust-todo-stub");
		expect(matches).toHaveLength(1);
	});

	it("does NOT flag files in tests/ at all (those are excluded from the scan by the source-file walker)", async () => {
		writeFile("tests/integration.rs", ["#[test]", "fn t() {", "    todo!()", "}", ""].join("\n"));
		const diagnostics = await detectRustPatterns(buildContext());
		expect(diagnostics).toEqual([]);
	});
});

describe("rust: doc-comment example unwraps", () => {
	it("does NOT flag `.unwrap()` inside a `/*! ... */` module-level doc comment with code examples", async () => {
		writeFile(
			"src/lib.rs",
			[
				"/*!",
				"This crate does things. Example:",
				"",
				"```rust",
				'let re = Regex::new(r"^x$").unwrap();',
				'assert!(re.is_match("x"));',
				"```",
				"*/",
				"",
				"pub fn run() {}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/rust-non-test-unwrap");
		expect(matches).toHaveLength(0);
	});

	it("treats `xxx_test.rs` (singular) as a test file too", async () => {
		writeFile(
			"src/compile_test.rs",
			["fn check() {", '    let v: i32 = "1".parse().unwrap();', "}", ""].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/rust-non-test-unwrap");
		expect(matches).toHaveLength(0);
	});
});
