import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectGoPatterns } from "../src/engines/ai-slop/go-patterns.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const buildContext = (): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["go"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-go-patterns-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("go: library-panic", () => {
	it("flags `panic()` in a non-main package", async () => {
		writeFile(
			"pkg/store/store.go",
			[
				"package store",
				"",
				"func Load(name string) string {",
				'    if name == "" {',
				'        panic("empty name")',
				"    }",
				"    return name",
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectGoPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/go-library-panic");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(5);
	});

	it("does NOT flag `panic()` in package main", async () => {
		writeFile(
			"cmd/server/main.go",
			[
				"package main",
				"",
				"func main() {",
				"    if err := run(); err != nil {",
				"        panic(err)",
				"    }",
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectGoPatterns(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("does NOT flag `panic()` in `_test.go` files", async () => {
		writeFile(
			"pkg/store/store_test.go",
			[
				"package store_test",
				"",
				"func TestLoad(t *testing.T) {",
				'    panic("test panic")',
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectGoPatterns(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("does NOT flag `panic()` in Go test support packages", async () => {
		writeFile(
			"internal/testutil/image.go",
			[
				"package testutil",
				"",
				"func MustImage() string {",
				'    panic("missing test fixture")',
				"}",
				"",
			].join("\n"),
		);
		writeFile(
			"cmd/devp2p/internal/ethtest/framework.go",
			[
				"package ethtest",
				"",
				"func MustPeer() string {",
				'    panic("bad test harness")',
				"}",
				"",
			].join("\n"),
		);
		writeFile(
			"pkg/parser/testdata/bad.go",
			[
				"package bad",
				"",
				"func Fixture() {",
				'    panic("fixture")',
				"}",
				"",
			].join("\n"),
		);

		const diagnostics = await detectGoPatterns(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("does NOT flag the word `panic` inside a comment or string literal", async () => {
		writeFile(
			"pkg/lib/lib.go",
			[
				"package lib",
				"",
				"// This function used to panic. We removed it.",
				'const Message = "do not panic"',
				"",
				"func Safe() string {",
				"    return Message",
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectGoPatterns(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("does NOT flag a panic preceded by an explanatory comment within ~3 lines", async () => {
		writeFile(
			"pkg/cmd/cmd.go",
			[
				"package cmd",
				"",
				"// checkGroups validates a sub-command's group. If the group isn't defined",
				"// we panic because it indicates a coding error that should be corrected.",
				"func checkGroups() {",
				'    panic("group not defined")',
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectGoPatterns(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("STILL flags an undocumented panic (no comment within 3 lines)", async () => {
		writeFile(
			"pkg/cmd/raw.go",
			[
				"package cmd",
				"",
				"func DoThing(name string) {",
				'    if name == "" {',
				'        panic("empty")',
				"    }",
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectGoPatterns(buildContext());
		expect(diagnostics).toHaveLength(1);
	});

	it("does NOT flag a `panic` immediately following a nil-guard `if x == nil {`", async () => {
		writeFile(
			"pkg/cache/cache.go",
			[
				"package cache",
				"",
				"func New(opts *Opts) {",
				"    if opts == nil {",
				'        panic("nil opts")',
				"    }",
				"    if opts.Log == nil {",
				'        panic("nil Log")',
				"    }",
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectGoPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/go-library-panic");
		expect(matches).toEqual([]);
	});

	it("STILL flags a panic with a long string arg even after a nil-guard line", async () => {
		writeFile(
			"pkg/lib/long.go",
			[
				"package lib",
				"",
				"func F(x *T) {",
				"    if x == nil {",
				'        panic("a really really long story about how this happened in production yesterday")',
				"    }",
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectGoPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/go-library-panic");
		expect(matches).toHaveLength(1);
	});

	it("flags multiple panics in the same library file with correct line numbers", async () => {
		writeFile(
			"pkg/lib/multi.go",
			[
				"package lib",
				"",
				"func A() {",
				'    panic("a")',
				"}",
				"",
				"func B() {",
				'    panic("b")',
				"}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectGoPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/go-library-panic");
		expect(matches.map((m) => m.line)).toEqual([4, 8]);
	});
});
