import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineContext } from "../../src/engines/types.js";

const { runSubprocess, chunkFilePaths } = vi.hoisted(() => ({
	runSubprocess: vi.fn(),
	chunkFilePaths: vi.fn(),
}));

vi.mock("../../src/utils/subprocess.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/utils/subprocess.js")>();
	return { ...actual, runSubprocess, chunkFilePaths };
});

const { parseClangTidyOutput, runClangTidy } = await import("../../src/engines/lint/clang-tidy.js");

const OUTPUT = [
	"/repo/src/foo.cpp:12:7: warning: variable 'x' is not initialized [cppcoreguidelines-init-variables]",
	"/repo/src/foo.cpp:20:1: error: use of undeclared identifier 'y' [clang-diagnostic-error]",
	"/repo/src/foo.cpp:12:7: note: initialize the variable 'x' to silence this warning",
	"12345 warnings generated.",
].join("\n");

describe("parseClangTidyOutput", () => {
	it("maps warning/error lines and ignores notes and summaries", () => {
		const diags = parseClangTidyOutput(OUTPUT, "/repo");
		expect(diags).toHaveLength(2);
		expect(diags[0]).toMatchObject({
			filePath: "src/foo.cpp",
			rule: "clang-tidy/cppcoreguidelines-init-variables",
			severity: "warning",
			line: 12,
			column: 7,
			category: "C++ Lint",
			engine: "lint",
		});
		expect(diags[1]).toMatchObject({
			rule: "clang-tidy/clang-diagnostic-error",
			severity: "error",
		});
	});

	// A project .clang-tidy with `WarningsAsErrors: "*"` makes clang-tidy append
	// `,-warnings-as-errors` to the bracketed check name. The real check id is the
	// first comma-separated entry; the pseudo-entry must not break the match or
	// leak into the rule id (else every finding is silently dropped).
	it("parses the real check id when WarningsAsErrors appends -warnings-as-errors", () => {
		const output = [
			"/repo/src/io.cpp:78:23: error: narrowing conversion from 'uint64_t' to 'int64_t' [bugprone-narrowing-conversions,-warnings-as-errors]",
			"/repo/src/io.cpp:15:9: warning: parameter name 'f' is too short [readability-identifier-length,-warnings-as-errors]",
		].join("\n");
		const diags = parseClangTidyOutput(output, "/repo");
		expect(diags).toHaveLength(2);
		expect(diags[0]).toMatchObject({
			rule: "clang-tidy/bugprone-narrowing-conversions",
			severity: "error",
			line: 78,
		});
		expect(diags[1]).toMatchObject({
			rule: "clang-tidy/readability-identifier-length",
			severity: "warning",
		});
	});
});

const makeContext = (rootDirectory: string, files: string[]): EngineContext =>
	({
		rootDirectory,
		files,
		config: { lint: {} },
	}) as unknown as EngineContext;

describe("runClangTidy - chunked invocation", () => {
	let dir: string;

	beforeEach(() => {
		runSubprocess.mockReset();
		chunkFilePaths.mockReset();
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-clang-tidy-"));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const writeDatabase = (files: string[]): void => {
		fs.writeFileSync(
			path.join(dir, "compile_commands.json"),
			JSON.stringify(files.map((file) => ({ directory: dir, file: path.basename(file) }))),
		);
	};

	it("runs one clang-tidy invocation per chunk and merges diagnostics across them", async () => {
		const fileA = path.join(dir, "a.cpp");
		const fileB = path.join(dir, "b.cpp");
		fs.writeFileSync(fileA, "int a;\n");
		fs.writeFileSync(fileB, "int b;\n");
		writeDatabase([fileA, fileB]);

		// Force two chunks (one file each) regardless of the real file-count/char
		// thresholds, so the merge logic is exercised without hundreds of real files.
		chunkFilePaths.mockImplementation((sources: string[]) => sources.map((source) => [source]));

		runSubprocess
			.mockResolvedValueOnce({
				stdout: "a.cpp:1:1: warning: bad a [some-check]",
				stderr: "",
				exitCode: 1,
			})
			.mockResolvedValueOnce({
				stdout: "b.cpp:1:1: warning: bad b [some-check]",
				stderr: "",
				exitCode: 1,
			});

		const diagnostics = await runClangTidy(makeContext(dir, [fileA, fileB]));

		expect(runSubprocess).toHaveBeenCalledTimes(2);
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.map((d) => d.filePath).sort()).toEqual(["a.cpp", "b.cpp"]);
	});

	it("logs a warning and returns [] for a chunk when clang-tidy is present but the invocation fails", async () => {
		const fileA = path.join(dir, "a.cpp");
		fs.writeFileSync(fileA, "int a;\n");
		writeDatabase([fileA]);
		chunkFilePaths.mockImplementation((sources: string[]) => [sources]);
		runSubprocess.mockRejectedValueOnce(new Error("Command timed out after 300000ms: clang-tidy"));
		const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const diagnostics = await runClangTidy(makeContext(dir, [fileA]));

		expect(diagnostics).toEqual([]);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0][0]).toContain("clang-tidy");
		warnSpy.mockRestore();
	});

	it("stays silent when clang-tidy itself is missing (ENOENT)", async () => {
		const fileA = path.join(dir, "a.cpp");
		fs.writeFileSync(fileA, "int a;\n");
		writeDatabase([fileA]);
		chunkFilePaths.mockImplementation((sources: string[]) => [sources]);
		const enoent = Object.assign(new Error("spawn clang-tidy ENOENT"), { code: "ENOENT" });
		runSubprocess.mockRejectedValueOnce(enoent);
		const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const diagnostics = await runClangTidy(makeContext(dir, [fileA]));

		expect(diagnostics).toEqual([]);
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
