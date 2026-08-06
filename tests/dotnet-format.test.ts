import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineDeps } from "../src/commands/fix-pipeline.js";
import { runFormattingStep } from "../src/commands/fix-pipeline.js";
import type { AislopConfig } from "../src/config/index.js";
import {
	buildDotnetFormatExcludeScope,
	fixDotnetFormat,
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

// `dotnet format --exclude` is matched by Microsoft.Extensions.FileSystemGlobbing,
// which understands literal paths, `*` and `**` and nothing else. Richer syntax is
// not rejected by the tool, it is silently ignored, so anything aislop cannot
// translate has to stop the fixer rather than be dropped from the command line.
describe("buildDotnetFormatExcludeScope", () => {
	it("excludes a bare directory as both the path and its subtree", () => {
		const scope = buildDotnetFormatExcludeScope(["external/VendorLib"]);

		expect(scope.excludeArguments).toEqual(["external/VendorLib", "external/VendorLib/**"]);
		expect(scope.unsupportedPatterns).toEqual([]);
	});

	it("anchors a bare dot-directory anywhere in the tree", () => {
		const scope = buildDotnetFormatExcludeScope([".claude"]);

		expect(scope.excludeArguments).toEqual(["**/.claude", "**/.claude/**"]);
	});

	it("passes star globs through verbatim", () => {
		const scope = buildDotnetFormatExcludeScope(["**/*.generated.cs"]);

		expect(scope.excludeArguments).toEqual(["**/*.generated.cs"]);
		expect(scope.unsupportedPatterns).toEqual([]);
	});

	it("expands a brace list into one argument per alternative", () => {
		const scope = buildDotnetFormatExcludeScope(["{Vendor,ThirdParty}/**"]);

		expect(scope.excludeArguments).toEqual(["Vendor/**", "ThirdParty/**"]);
		expect(scope.unsupportedPatterns).toEqual([]);
	});

	it("reports syntax dotnet format cannot express instead of passing it", () => {
		const scope = buildDotnetFormatExcludeScope(["src/[Gg]enerated/**", "Vendor"]);

		expect(scope.unsupportedPatterns).toEqual(["src/[Gg]enerated/**"]);
		// The expressible pattern is still scoped; only the untranslatable one is held back.
		expect(scope.excludeArguments).toEqual(["Vendor", "Vendor/**"]);
	});

	it("returns an empty scope when nothing is excluded", () => {
		expect(buildDotnetFormatExcludeScope(undefined)).toEqual({
			excludeArguments: [],
			unsupportedPatterns: [],
		});
		expect(buildDotnetFormatExcludeScope([])).toEqual({
			excludeArguments: [],
			unsupportedPatterns: [],
		});
	});
});

describe("dotnet format exclude scoping", () => {
	let tmpDir: string;

	const scopedContext = (
		rootDirectory: string,
		excludePatterns?: string[],
	): Pick<EngineContext, "rootDirectory" | "excludePatterns"> => ({
		rootDirectory,
		excludePatterns,
	});

	// The arguments dotnet format was told to exclude: everything between
	// `--exclude` and the next option.
	const excludeArgumentsOf = (call: number): string[] => {
		const argv = runSubprocessMock.mock.calls[call][1] as string[];
		const start = argv.indexOf("--exclude");
		if (start === -1) return [];
		const rest = argv.slice(start + 1);
		const end = rest.findIndex((argument) => argument.startsWith("--"));
		return end === -1 ? rest : rest.slice(0, end);
	};

	const writeWarmProject = (root: string, name: string): string => {
		const directory = path.join(root, name);
		fs.mkdirSync(path.join(directory, "obj"), { recursive: true });
		const csproj = path.join(directory, `${name}.csproj`);
		fs.writeFileSync(csproj, "");
		fs.writeFileSync(path.join(directory, "obj", "project.assets.json"), "{}");
		return csproj;
	};

	beforeEach(() => {
		runSubprocessMock.mockReset();
		runSubprocessMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-format-exclude-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("scopes the rewrite so an excluded folder is left alone", async () => {
		writeWarmProject(tmpDir, "App");

		await fixDotnetFormat(scopedContext(tmpDir, ["external/VendorLib"]));

		expect(runSubprocessMock).toHaveBeenCalledTimes(1);
		expect(excludeArgumentsOf(0)).toEqual(["external/VendorLib", "external/VendorLib/**"]);
	});

	it("scopes the check pass with the same excludes the rewrite honors", async () => {
		const warm = writeWarmProject(tmpDir, "App");

		await runDotnetFormat({
			...scopedContext(tmpDir, ["external/VendorLib"]),
			languages: ["csharp"],
			frameworks: [],
			installedTools: { dotnet: true },
			config: {
				quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
				security: { audit: false, auditTimeout: 0 },
				lint: { typecheck: false },
			},
		} as EngineContext);

		expect(runSubprocessMock.mock.calls[0][1]).toContain(warm);
		expect(excludeArgumentsOf(0)).toEqual(["external/VendorLib", "external/VendorLib/**"]);
		// The report option has to survive the inserted excludes.
		expect(runSubprocessMock.mock.calls[0][1]).toContain("--verify-no-changes");
	});

	it("passes no exclude option when nothing is excluded", async () => {
		writeWarmProject(tmpDir, "App");

		await fixDotnetFormat(scopedContext(tmpDir));

		expect(runSubprocessMock.mock.calls[0][1]).not.toContain("--exclude");
	});

	it("drops an excluded project from the targets entirely", async () => {
		writeWarmProject(tmpDir, "Vendored");

		await fixDotnetFormat(scopedContext(tmpDir, ["Vendored"]));

		expect(runSubprocessMock).not.toHaveBeenCalled();
	});

	it("refuses to rewrite when an exclude pattern cannot be expressed", async () => {
		writeWarmProject(tmpDir, "App");

		await expect(fixDotnetFormat(scopedContext(tmpDir, ["src/[Gg]enerated/**"]))).rejects.toThrow(
			"src/[Gg]enerated/**",
		);
		expect(runSubprocessMock).not.toHaveBeenCalled();
	});
});

describe("runFormattingStep C# exclude gate", () => {
	const formattingDeps = (excludePatterns: string[]): { deps: PipelineDeps; steps: string[] } => {
		const steps: string[] = [];
		const deps = {
			rail: { start: () => {}, setActiveLabel: () => {} },
			context: {
				rootDirectory: path.join(path.sep, "repo"),
				languages: ["csharp"],
				frameworks: [],
				excludePatterns,
				installedTools: { dotnet: true },
				config: {
					lint: { csharp: { projectEvaluation: true } },
				} as PipelineDeps["context"]["config"],
			},
			config: { engines: { format: true } } as unknown as AislopConfig,
			resolvedDir: path.join(path.sep, "repo"),
			projectInfo: {
				languages: ["csharp"],
				installedTools: { dotnet: true },
			} as PipelineDeps["projectInfo"],
			force: false,
			safe: false,
			runStep: async (name: string) => {
				steps.push(name);
				return {
					name,
					beforeIssues: 0,
					afterIssues: 0,
					resolvedIssues: 0,
					beforeFiles: 0,
					failed: false,
					elapsedMs: 0,
				};
			},
		} as unknown as PipelineDeps;
		return { deps, steps };
	};

	it("formats C# when every exclude pattern is expressible", async () => {
		const { deps, steps } = formattingDeps(["external/VendorLib", "**/*.generated.cs"]);

		await runFormattingStep(deps);

		expect(steps).toEqual(["Formatting (csharp)"]);
	});

	it("skips C# formatting rather than reformat code it cannot exclude", async () => {
		const { deps, steps } = formattingDeps(["src/[Gg]enerated/**"]);

		await runFormattingStep(deps);

		expect(steps).toEqual([]);
	});
});
