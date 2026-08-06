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

const { buildCppcheckArgs, CPP_LINT_DEFAULTS, parseCppcheckXml, runCppcheck } = await import(
	"../../src/engines/lint/cppcheck.js"
);

describe("buildCppcheckArgs", () => {
	it("passes --language=c++ for a C++ tree and suppresses parse-context diagnostics", () => {
		const args = buildCppcheckArgs(["/p/a.cpp", "/p/a.h"], CPP_LINT_DEFAULTS);
		expect(args).toContain("--language=c++");
		expect(args).toContain("--suppress=syntaxError");
		expect(args).toContain("--suppress=unknownMacro");
		expect(args).toContain(`--enable=${CPP_LINT_DEFAULTS.cppcheckEnable}`);
		// sources come last, after the flags.
		expect(args.slice(-2)).toEqual(["/p/a.cpp", "/p/a.h"]);
	});

	it("omits --language=c++ for a pure C tree", () => {
		const args = buildCppcheckArgs(["/p/a.c", "/p/a.h"], CPP_LINT_DEFAULTS);
		expect(args).not.toContain("--language=c++");
		// parse-context suppressions still apply regardless of language.
		expect(args).toContain("--suppress=syntaxError");
	});

	it("honors an explicit isCppTree flag instead of re-deriving it from a chunk", () => {
		// A chunk containing only .c files must still get --language=c++ when the
		// caller already determined (from the whole source set) that the tree is C++.
		const args = buildCppcheckArgs(["/p/a.c"], CPP_LINT_DEFAULTS, true);
		expect(args).toContain("--language=c++");
	});

	it("passes -j with a positive job count so cppcheck fans out across cores", () => {
		const args = buildCppcheckArgs(["/p/a.cpp"], CPP_LINT_DEFAULTS);
		const jobFlagIndex = args.indexOf("-j");
		expect(jobFlagIndex).toBeGreaterThanOrEqual(0);
		const jobCount = Number(args[jobFlagIndex + 1]);
		expect(Number.isInteger(jobCount)).toBe(true);
		expect(jobCount).toBeGreaterThanOrEqual(1);
	});

	it("omits -j when the configured enable list turns on unusedFunction (a whole-program check)", () => {
		const args = buildCppcheckArgs(["/p/a.cpp"], {
			...CPP_LINT_DEFAULTS,
			cppcheckEnable: "warning,unusedFunction",
		});
		expect(args).not.toContain("-j");
	});

	it("omits -j when the configured enable list is 'all' (implies unusedFunction)", () => {
		const args = buildCppcheckArgs(["/p/a.cpp"], { ...CPP_LINT_DEFAULTS, cppcheckEnable: "all" });
		expect(args).not.toContain("-j");
	});

	it("keeps -j when the enable list merely contains 'unusedFunction' as a substring, not a token", () => {
		// Token match, not substring: an enable value that happens to contain the
		// text "unusedFunction" without being that exact check id must not gate -j.
		const args = buildCppcheckArgs(["/p/a.cpp"], {
			...CPP_LINT_DEFAULTS,
			cppcheckEnable: "warning,notARealUnusedFunctionCheck",
		});
		expect(args).toContain("-j");
	});
});

const XML = `<?xml version="1.0"?>
<results version="2">
  <cppcheck version="2.13"/>
  <errors>
    <error id="nullPointer" severity="error" msg="Null pointer dereference: p">
      <location file="src/foo.cpp" line="42" column="5"/>
    </error>
    <error id="unreadVariable" severity="style" msg="Variable 'x' is assigned a value that is never used.">
      <location file="src/foo.cpp" line="10" column="3"/>
    </error>
    <error id="missingIncludeSystem" severity="information" msg="ignored">
      <location file="src/foo.cpp" line="1" column="1"/>
    </error>
    <error id="noLoc" severity="error" msg="no location element"/>
  </errors>
</results>`;

describe("parseCppcheckXml", () => {
	it("maps errors, downgrades non-error severities to warning, drops information and locationless", () => {
		const diags = parseCppcheckXml(XML, "/repo");
		expect(diags).toHaveLength(2);
		expect(diags[0]).toMatchObject({
			filePath: "src/foo.cpp",
			engine: "lint",
			rule: "cppcheck/nullPointer",
			severity: "error",
			line: 42,
			column: 5,
			category: "C++ Lint",
			fixable: false,
		});
		expect(diags[1]).toMatchObject({ rule: "cppcheck/unreadVariable", severity: "warning" });
	});

	it("returns [] on empty or junk input", () => {
		expect(parseCppcheckXml("", "/repo")).toEqual([]);
		expect(parseCppcheckXml("not xml", "/repo")).toEqual([]);
	});
});

const makeContext = (rootDirectory: string, files: string[]): EngineContext =>
	({
		rootDirectory,
		files,
		languages: ["cpp"],
		frameworks: [],
		installedTools: { cppcheck: true },
		config: {
			quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
			security: { audit: false, auditTimeout: 1000 },
			lint: { typecheck: false, expoDoctor: false },
		},
	});

describe("runCppcheck - chunked invocation", () => {
	let dir: string;

	beforeEach(() => {
		runSubprocess.mockReset();
		chunkFilePaths.mockReset();
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-cppcheck-"));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("runs one cppcheck invocation per chunk and merges diagnostics across them", async () => {
		const fileA = path.join(dir, "a.cpp");
		const fileB = path.join(dir, "b.cpp");
		fs.writeFileSync(fileA, "int a;\n");
		fs.writeFileSync(fileB, "int b;\n");

		// Force two chunks (one file each) regardless of the real file-count/char
		// thresholds, so the merge logic is exercised without hundreds of real files.
		chunkFilePaths.mockImplementation((sources: string[]) => sources.map((source) => [source]));

		runSubprocess
			.mockResolvedValueOnce({
				stdout: "",
				stderr:
					'<results><errors><error id="nullPointer" severity="error" msg="bad a"><location file="a.cpp" line="1" column="1"/></error></errors></results>',
				exitCode: 1,
			})
			.mockResolvedValueOnce({
				stdout: "",
				stderr:
					'<results><errors><error id="nullPointer" severity="error" msg="bad b"><location file="b.cpp" line="1" column="1"/></error></errors></results>',
				exitCode: 1,
			});

		const diagnostics = await runCppcheck(makeContext(dir, [fileA, fileB]));

		expect(runSubprocess).toHaveBeenCalledTimes(2);
		expect(diagnostics.map((d) => d.message).sort()).toEqual(["bad a", "bad b"]);
	});

	it("logs a warning and emits an advisory chunks-skipped diagnostic when a chunk times out", async () => {
		const fileA = path.join(dir, "a.cpp");
		fs.writeFileSync(fileA, "int a;\n");
		chunkFilePaths.mockImplementation((sources: string[]) => [sources]);
		runSubprocess.mockRejectedValueOnce(new Error("Command timed out after 180000ms: cppcheck"));
		const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const diagnostics = await runCppcheck(makeContext(dir, [fileA]));

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			rule: "cppcheck/chunks-skipped",
			severity: "info",
			filePath: "a.cpp",
			category: "C++ Lint",
			fixable: false,
		});
		expect(diagnostics[0].message).toContain("skipped 1 of 1 chunk");
		expect(diagnostics[0].message).toContain("1 file total");
		expect(diagnostics[0].message).toContain("timed out");
		expect(diagnostics[0].message).toContain("files a.cpp (1 file)");

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0][0]).toContain("cppcheck");
		expect(warnSpy.mock.calls[0][0]).toContain("a.cpp");
		warnSpy.mockRestore();
	});

	it("stays silent when cppcheck itself is missing (ENOENT)", async () => {
		const fileA = path.join(dir, "a.cpp");
		fs.writeFileSync(fileA, "int a;\n");
		chunkFilePaths.mockImplementation((sources: string[]) => [sources]);
		const enoent = Object.assign(new Error("spawn cppcheck ENOENT"), { code: "ENOENT" });
		runSubprocess.mockRejectedValueOnce(enoent);
		const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const diagnostics = await runCppcheck(makeContext(dir, [fileA]));

		expect(diagnostics).toEqual([]);
		expect(warnSpy).not.toHaveBeenCalled();
		expect(diagnostics.some((d) => d.rule === "cppcheck/chunks-skipped")).toBe(false);
		warnSpy.mockRestore();
	});

	it("omits cppcheck/chunks-skipped entirely when every chunk succeeds", async () => {
		const fileA = path.join(dir, "a.cpp");
		const fileB = path.join(dir, "b.cpp");
		fs.writeFileSync(fileA, "int a;\n");
		fs.writeFileSync(fileB, "int b;\n");
		chunkFilePaths.mockImplementation((sources: string[]) => sources.map((source) => [source]));
		runSubprocess.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
		runSubprocess.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

		const diagnostics = await runCppcheck(makeContext(dir, [fileA, fileB]));

		expect(diagnostics.some((d) => d.rule === "cppcheck/chunks-skipped")).toBe(false);
	});

	it("keeps findings from chunks that succeed alongside the advisory for chunks that fail", async () => {
		const fileA = path.join(dir, "a.cpp");
		const fileB = path.join(dir, "b.cpp");
		fs.writeFileSync(fileA, "int a;\n");
		fs.writeFileSync(fileB, "int b;\n");
		chunkFilePaths.mockImplementation((sources: string[]) => sources.map((source) => [source]));
		runSubprocess
			.mockResolvedValueOnce({
				stdout: "",
				stderr:
					'<results><errors><error id="nullPointer" severity="error" msg="bad a"><location file="a.cpp" line="1" column="1"/></error></errors></results>',
				exitCode: 1,
			})
			.mockRejectedValueOnce(new Error("spawn cppcheck EACCES"));
		const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const diagnostics = await runCppcheck(makeContext(dir, [fileA, fileB]));

		expect(diagnostics.find((d) => d.rule === "cppcheck/nullPointer")?.message).toBe("bad a");
		const skipped = diagnostics.find((d) => d.rule === "cppcheck/chunks-skipped");
		expect(skipped?.message).toContain("skipped 1 of 2 chunk");
		expect(skipped?.message).toContain("failed");
		expect(skipped?.message).not.toContain("timed out");
		warnSpy.mockRestore();
	});

	it("caps the listed chunk ranges at 3 and summarizes the rest, mixing failure reasons when they differ", async () => {
		const files = ["a", "b", "c", "d"].map((name) => path.join(dir, `${name}.cpp`));
		for (const file of files) fs.writeFileSync(file, "int x;\n");
		chunkFilePaths.mockImplementation((sources: string[]) => sources.map((source) => [source]));
		runSubprocess
			.mockRejectedValueOnce(new Error("Command timed out after 180000ms: cppcheck"))
			.mockRejectedValueOnce(new Error("spawn cppcheck EACCES"))
			.mockRejectedValueOnce(new Error("Command timed out after 180000ms: cppcheck"))
			.mockRejectedValueOnce(new Error("spawn cppcheck EACCES"));
		const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const diagnostics = await runCppcheck(makeContext(dir, files));

		const skipped = diagnostics.find((d) => d.rule === "cppcheck/chunks-skipped");
		expect(skipped?.message).toContain("skipped 4 of 4 chunks");
		expect(skipped?.message).toContain("and 1 more");
		expect(skipped?.message).toMatch(/timed out.*failed|failed.*timed out/);
		warnSpy.mockRestore();
	});
});
