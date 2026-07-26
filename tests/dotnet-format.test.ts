import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	parseDotnetFormatReport,
	runDotnetFormat,
} from "../src/engines/format/dotnet-format.js";
import type { EngineContext } from "../src/engines/types.js";

const { runSubprocessMock } = vi.hoisted(() => ({ runSubprocessMock: vi.fn() }));
vi.mock("../src/utils/subprocess.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/utils/subprocess.js")>();
	return { ...original, runSubprocess: runSubprocessMock };
});

const ROOT = path.join(path.sep, "repo");

const report = (files: unknown): string => JSON.stringify(files);

const fileEntry = (relPath: string, changeCount = 1): unknown => ({
	FileName: path.basename(relPath),
	FilePath: path.join(ROOT, relPath),
	FileChanges: Array.from({ length: changeCount }, (_, i) => ({
		LineNumber: i + 1,
		CharNumber: 1,
		DiagnosticId: "WHITESPACE",
		FormatDescription: "Fix whitespace formatting.",
	})),
});

describe("parseDotnetFormatReport", () => {
	it("emits one warning per unformatted file with a project-relative path", () => {
		const diagnostics = parseDotnetFormatReport(report([fileEntry("src/Foo.cs", 7)]), ROOT);

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].rule).toBe("csharp-formatting");
		expect(diagnostics[0].engine).toBe("format");
		// POSIX separators on every OS (relativePosix); guards the Windows backslash regression.
		expect(diagnostics[0].filePath).toBe("src/Foo.cs");
		expect(diagnostics[0].fixable).toBe(true);
		// One finding per file, not one per whitespace change.
		expect(diagnostics).toHaveLength(1);
	});

	it("skips files with no changes", () => {
		const diagnostics = parseDotnetFormatReport(
			report([{ FileName: "Clean.cs", FilePath: path.join(ROOT, "Clean.cs"), FileChanges: [] }]),
			ROOT,
		);
		expect(diagnostics).toEqual([]);
	});

	it("dedupes a file reported under more than one entry", () => {
		const diagnostics = parseDotnetFormatReport(
			report([fileEntry("src/Foo.cs"), fileEntry("src/Foo.cs")]),
			ROOT,
		);
		expect(diagnostics).toHaveLength(1);
	});

	it("falls back to FileName when FilePath is absent", () => {
		const diagnostics = parseDotnetFormatReport(
			report([{ FileName: "Bar.cs", FileChanges: [{ DiagnosticId: "WHITESPACE" }] }]),
			ROOT,
		);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].filePath).toBe("Bar.cs");
	});

	it("returns nothing for empty, non-array, or invalid output", () => {
		expect(parseDotnetFormatReport("", ROOT)).toEqual([]);
		expect(parseDotnetFormatReport("not json", ROOT)).toEqual([]);
		expect(parseDotnetFormatReport(JSON.stringify({ projects: [] }), ROOT)).toEqual([]);
	});
});

describe("runDotnetFormat restore-evidence gating", () => {
	let tmpDir: string;

	const formatContext = (rootDirectory: string): EngineContext => ({
		rootDirectory,
		languages: ["csharp"],
		frameworks: [],
		installedTools: { dotnet: true },
		config: {
			quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
			security: { audit: false, auditTimeout: 0 },
			lint: { typecheck: false },
		},
	});

	beforeEach(() => {
		runSubprocessMock.mockReset();
		runSubprocessMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-format-gate-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("formats only projects with restore evidence, silently skipping cold ones", async () => {
		const warmDir = path.join(tmpDir, "Warm");
		fs.mkdirSync(path.join(warmDir, "obj"), { recursive: true });
		const warm = path.join(warmDir, "Warm.csproj");
		fs.writeFileSync(warm, "");
		fs.writeFileSync(path.join(warmDir, "obj", "project.assets.json"), "{}");
		fs.mkdirSync(path.join(tmpDir, "Cold"));
		fs.writeFileSync(path.join(tmpDir, "Cold", "Cold.csproj"), "");

		const diagnostics = await runDotnetFormat(formatContext(tmpDir));

		expect(diagnostics).toEqual([]);
		expect(runSubprocessMock).toHaveBeenCalledTimes(1);
		expect(runSubprocessMock.mock.calls[0][1]).toContain(warm);
	});
});
