import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	filterSourcesInDatabase,
	findCompileCommandsDir,
	findCppSourcesForRoot,
	hasCppOnlySources,
	readCompileCommandsFiles,
} from "../src/engines/cpp-targets.js";

describe("cpp-targets", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-cpp-targets-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("collects C/C++ sources and skips build output", () => {
		fs.mkdirSync(path.join(tmpDir, "src"));
		fs.writeFileSync(path.join(tmpDir, "src", "a.cpp"), "int a;\n");
		fs.writeFileSync(path.join(tmpDir, "src", "a.h"), "int a;\n");
		fs.mkdirSync(path.join(tmpDir, "build"));
		fs.writeFileSync(path.join(tmpDir, "build", "gen.cpp"), "int g;\n");
		const names = findCppSourcesForRoot(tmpDir)
			.map((f) => path.basename(f))
			.sort();
		expect(names).toEqual(["a.cpp", "a.h"]);
	});

	it("finds compile_commands.json at root or under build/", () => {
		fs.mkdirSync(path.join(tmpDir, "build"));
		fs.writeFileSync(path.join(tmpDir, "build", "compile_commands.json"), "[]\n");
		expect(findCompileCommandsDir({ rootDirectory: tmpDir })).toBe(path.join(tmpDir, "build"));
	});

	it("returns null when compile_commands.json is absent", () => {
		fs.mkdirSync(path.join(tmpDir, "src"));
		fs.writeFileSync(path.join(tmpDir, "src", "a.cpp"), "int a;\n");
		expect(findCompileCommandsDir({ rootDirectory: tmpDir })).toBe(null);
	});

	it("finds compile_commands.json nested one level under build/ (e.g. build/lint)", () => {
		const lintDir = path.join(tmpDir, "build", "lint");
		fs.mkdirSync(lintDir, { recursive: true });
		fs.writeFileSync(path.join(lintDir, "compile_commands.json"), "[]\n");
		expect(findCompileCommandsDir({ rootDirectory: tmpDir })).toBe(lintDir);
	});

	it("finds compile_commands.json three levels deep in build trees", () => {
		const nestedDir = path.join(tmpDir, "build", "out", "Debug", "x64");
		fs.mkdirSync(nestedDir, { recursive: true });
		fs.writeFileSync(path.join(nestedDir, "compile_commands.json"), "[]\n");
		expect(findCompileCommandsDir({ rootDirectory: tmpDir })).toBe(nestedDir);
	});

	it("finds compile_commands.json nested deeper under build-like trees", () => {
		const nestedDir = path.join(tmpDir, "build", "out", "Debug");
		fs.mkdirSync(nestedDir, { recursive: true });
		fs.writeFileSync(path.join(nestedDir, "compile_commands.json"), "[]\n");
		expect(findCompileCommandsDir({ rootDirectory: tmpDir })).toBe(nestedDir);
	});

	it("finds compile_commands.json in nested cmake-build-style layouts", () => {
		const nestedDir = path.join(tmpDir, "cmake-build-debug", "RelWithDebInfo");
		fs.mkdirSync(nestedDir, { recursive: true });
		fs.writeFileSync(path.join(nestedDir, "compile_commands.json"), "[]\n");
		expect(findCompileCommandsDir({ rootDirectory: tmpDir })).toBe(nestedDir);
	});

	it("prefers the build-root database over one buried in a pruned CMakeFiles tree", () => {
		const rootDatabase = path.join(tmpDir, "build");
		const prunedDir = path.join(tmpDir, "build", "CMakeFiles", "Debug");
		fs.mkdirSync(prunedDir, { recursive: true });
		fs.writeFileSync(path.join(prunedDir, "compile_commands.json"), "[]\n");
		fs.writeFileSync(path.join(rootDatabase, "compile_commands.json"), "[]\n");
		expect(findCompileCommandsDir({ rootDirectory: tmpDir })).toBe(rootDatabase);
	});

	it("does not descend into pruned build-internal directories (CMakeFiles, _deps)", () => {
		for (const pruned of ["CMakeFiles", "_deps"]) {
			const buriedDir = path.join(tmpDir, "build", pruned, "nested");
			fs.mkdirSync(buriedDir, { recursive: true });
			fs.writeFileSync(path.join(buriedDir, "compile_commands.json"), "[]\n");
		}
		expect(findCompileCommandsDir({ rootDirectory: tmpDir })).toBeNull();
	});

	it("detects a C++ tree from C++-only extensions and not from pure C", () => {
		expect(hasCppOnlySources(["/p/a.c", "/p/a.h"])).toBe(false);
		expect(hasCppOnlySources(["/p/a.c", "/p/b.cpp"])).toBe(true);
		expect(hasCppOnlySources(["/p/widget.hpp"])).toBe(true);
	});

	it("reads the translation units a compile database describes", () => {
		const db = [
			{ directory: tmpDir, file: path.join(tmpDir, "src", "a.cpp"), command: "clang a.cpp" },
			{ directory: tmpDir, file: "src/b.cpp", command: "clang src/b.cpp" },
		];
		fs.writeFileSync(path.join(tmpDir, "compile_commands.json"), JSON.stringify(db));
		const files = readCompileCommandsFiles(tmpDir);
		expect(files).toHaveLength(2);
		// filterSourcesInDatabase keeps only sources the database lists.
		const kept = filterSourcesInDatabase(
			[path.join(tmpDir, "src", "a.cpp"), path.join(tmpDir, "src", "posix-only.cpp")],
			files,
		);
		expect(kept.map((f) => path.basename(f))).toEqual(["a.cpp"]);
	});

	it("filterSourcesInDatabase passes all sources through when the database is empty", () => {
		const sources = ["/p/a.cpp", "/p/b.cpp"];
		expect(filterSourcesInDatabase(sources, [])).toEqual(sources);
	});

	it("readCompileCommandsFiles returns [] for a missing or malformed database", () => {
		expect(readCompileCommandsFiles(tmpDir)).toEqual([]);
		fs.writeFileSync(path.join(tmpDir, "compile_commands.json"), "{ not json");
		expect(readCompileCommandsFiles(tmpDir)).toEqual([]);
	});
});
