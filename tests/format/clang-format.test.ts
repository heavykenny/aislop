import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import {
	chunkFilePaths,
	hasClangFormatConfig,
	parseClangFormatViolations,
	runClangFormat,
} from "../../src/engines/format/clang-format.js";
import type { EngineContext } from "../../src/engines/types.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-clang-format-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const makeContext = (
	rootDirectory: string,
	overrides: Partial<EngineContext> = {},
): EngineContext => ({
	rootDirectory,
	languages: ["cpp"],
	frameworks: [],
	installedTools: { "clang-format": true },
	config: {
		quality: DEFAULT_CONFIG.quality,
		security: DEFAULT_CONFIG.security,
		lint: DEFAULT_CONFIG.lint,
	},
	...overrides,
});

describe("hasClangFormatConfig", () => {
	it("detects a .clang-format file", () => {
		fs.writeFileSync(path.join(tmpDir, ".clang-format"), "BasedOnStyle: Google\n");
		expect(hasClangFormatConfig(tmpDir)).toBe(true);
	});

	it("detects a _clang-format file", () => {
		fs.writeFileSync(path.join(tmpDir, "_clang-format"), "BasedOnStyle: LLVM\n");
		expect(hasClangFormatConfig(tmpDir)).toBe(true);
	});

	it("returns false when no config is present", () => {
		fs.mkdirSync(path.join(tmpDir, "src"));
		fs.writeFileSync(path.join(tmpDir, "src", "a.cpp"), "int a;\n");
		expect(hasClangFormatConfig(tmpDir)).toBe(false);
	});
});

describe("runClangFormat", () => {
	it("returns [] when no .clang-format is present", async () => {
		fs.mkdirSync(path.join(tmpDir, "src"));
		fs.writeFileSync(path.join(tmpDir, "src", "a.cpp"), "int  a ;\n");
		const context = makeContext(tmpDir);
		expect(await runClangFormat(context)).toEqual([]);
	});
});

describe("chunkFilePaths", () => {
	it("puts everything in one chunk when well under both limits", () => {
		const files = ["a.cpp", "b.cpp", "c.cpp"];
		expect(chunkFilePaths(files, 200, 25000)).toEqual([files]);
	});

	it("splits once the file-count cap is hit", () => {
		const files = Array.from({ length: 5 }, (_, i) => `f${i}.cpp`);
		const chunks = chunkFilePaths(files, 2, 25000);
		expect(chunks).toEqual([["f0.cpp", "f1.cpp"], ["f2.cpp", "f3.cpp"], ["f4.cpp"]]);
	});

	it("splits once the character budget is hit", () => {
		// Each path is 10 chars + 1 separator = 11; a budget of 25 fits two per chunk.
		const files = ["aaaaaaaa.c", "bbbbbbbb.c", "cccccccc.c", "dddddddd.c"];
		const chunks = chunkFilePaths(files, 200, 25);
		expect(chunks).toEqual([
			["aaaaaaaa.c", "bbbbbbbb.c"],
			["cccccccc.c", "dddddddd.c"],
		]);
	});

	it("gives an over-budget lone file its own chunk instead of dropping it", () => {
		const hugePath = "x".repeat(100);
		const files = [hugePath, "short.cpp"];
		const chunks = chunkFilePaths(files, 200, 25);
		expect(chunks).toEqual([[hugePath], ["short.cpp"]]);
	});

	it("returns [] for an empty file list", () => {
		expect(chunkFilePaths([])).toEqual([]);
	});
});

describe("parseClangFormatViolations", () => {
	it("extracts each distinct flagged file from a multi-file dry-run report", () => {
		const stderr = [
			"bad1.cpp:1:4: error: code should be clang-formatted [-Wclang-format-violations]",
			"int   a=1;",
			"   ^",
			"bad1.cpp:2:6: error: code should be clang-formatted [-Wclang-format-violations]",
			"int b=2;",
			"     ^",
			"bad2.cpp:1:4: error: code should be clang-formatted [-Wclang-format-violations]",
			"int   c=3;",
			"   ^",
		].join("\n");
		expect(parseClangFormatViolations(stderr)).toEqual(new Set(["bad1.cpp", "bad2.cpp"]));
	});

	it("handles a Windows absolute path whose drive letter contains a colon", () => {
		const stderr =
			"C:\\repo\\src\\bad.cpp:1:4: error: code should be clang-formatted [-Wclang-format-violations]\nint   a=1;\n   ^";
		expect(parseClangFormatViolations(stderr)).toEqual(new Set(["C:\\repo\\src\\bad.cpp"]));
	});

	it("returns an empty set when there is no violation line", () => {
		expect(parseClangFormatViolations("")).toEqual(new Set());
		expect(parseClangFormatViolations("doesnotexist.cpp: no such file or directory")).toEqual(
			new Set(),
		);
	});
});
