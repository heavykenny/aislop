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
			[
				"pub fn read_port(s: &str) -> u16 {",
				"    s.parse::<u16>().unwrap()",
				"}",
				"",
			].join("\n"),
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
		writeFile(
			"src/lib.rs",
			["pub fn unfinished() -> i32 {", "    todo!()", "}", ""].join("\n"),
		);
		const diagnostics = await detectRustPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/rust-todo-stub");
		expect(matches).toHaveLength(1);
	});

	it("flags `unimplemented!()` too", async () => {
		writeFile(
			"src/lib.rs",
			["pub fn nope() -> i32 {", "    unimplemented!(\"later\")", "}", ""].join("\n"),
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
