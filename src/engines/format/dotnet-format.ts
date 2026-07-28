import fs from "node:fs";
import path from "node:path";
import micromatch from "micromatch";
import { normalizeExcludePatterns } from "../../utils/exclude.js";
import { toPosix } from "../../utils/paths.js";
import { runSubprocess } from "../../utils/subprocess.js";
import { findDotnetTargets } from "../dotnet-targets.js";
import type { Diagnostic, EngineContext } from "../types.js";

// `dotnet format whitespace --verify-no-changes --report <file>` writes a JSON
// array: [ { FileName, FilePath, FileChanges: [ { LineNumber, CharNumber,
// DiagnosticId, FormatDescription } ] } ]. Exit code is 2 when changes are needed,
// but the written report - not the code - is the signal. We deliberately run only
// the `whitespace` subcommand (the direct analogue of gofmt/rustfmt: pure layout):
// the `analyzers` subcommand would overlap the roslynator lint engine, and `style`
// rewrites are noisier than a formatter should be on a repo without a tuned
// .editorconfig.

interface DotnetFormatFileChange {
	LineNumber?: number;
	CharNumber?: number;
	DiagnosticId?: string;
	FormatDescription?: string;
}
interface DotnetFormatFile {
	FileName?: string;
	FilePath?: string;
	FileChanges?: DotnetFormatFileChange[];
}

const REPORT_FILENAME = ".aislop-dotnet-format.json";

// One finding per unformatted file (mirroring gofmt), not per whitespace change -
// a misformatted file emits dozens of changes that all mean "run the formatter".
export const parseDotnetFormatReport = (json: string, rootDirectory: string): Diagnostic[] => {
	if (!json) return [];
	let report: DotnetFormatFile[];
	try {
		const parsed = JSON.parse(json);
		if (!Array.isArray(parsed)) return [];
		report = parsed as DotnetFormatFile[];
	} catch {
		return [];
	}

	const seen = new Set<string>();
	const diagnostics: Diagnostic[] = [];
	for (const file of report) {
		if (!file.FileChanges || file.FileChanges.length === 0) continue;
		const raw = file.FilePath ?? file.FileName;
		if (!raw) continue;
		const filePath = toPosix(path.isAbsolute(raw) ? path.relative(rootDirectory, raw) : raw);
		if (seen.has(filePath)) continue;
		seen.add(filePath);
		diagnostics.push({
			filePath,
			engine: "format",
			rule: "csharp-formatting",
			severity: "warning",
			message: "C# file is not formatted correctly",
			help: "Run `aislop fix` to auto-format with dotnet format",
			line: 0,
			column: 0,
			category: "Format",
			fixable: true,
		});
	}
	return diagnostics;
};

const reportPathFor = (rootDirectory: string): string => path.join(rootDirectory, REPORT_FILENAME);

// Syntax micromatch accepts that Microsoft.Extensions.FileSystemGlobbing does
// not: character classes, extglobs, negation, and escapes have no equivalent,
// and a leading "-" would be parsed as another option rather than a path.
// Brace lists are expanded before this test rather than rejected by it.
const UNSUPPORTED_GLOB_SYNTAX = /[?[\]{}!|()\\]/;

const isDotnetFormatPath = (pattern: string): boolean =>
	!pattern.startsWith("-") && !UNSUPPORTED_GLOB_SYNTAX.test(pattern);

export interface DotnetFormatExcludeScope {
	/** Patterns to hand to `dotnet format --exclude`. */
	excludeArguments: string[];
	/** Patterns dotnet format has no way to express. */
	unsupportedPatterns: string[];
}

// `dotnet format --exclude` takes relative file or folder paths matched with
// Microsoft.Extensions.FileSystemGlobbing against the process working directory.
// We always run it in the scan root, so aislop's root-relative exclude globs
// line up verbatim, and the shared normalization keeps a bare directory entry
// meaning the same thing here as it does to the file-scanning engines. The
// matcher understands literal segments, `*` and `**` and nothing else, so
// anything richer is reported back for the caller to act on: a fixer that
// silently dropped an unmatchable pattern would rewrite excluded code.
export const buildDotnetFormatExcludeScope = (
	excludePatterns: string[] | undefined,
): DotnetFormatExcludeScope => {
	const scope: DotnetFormatExcludeScope = { excludeArguments: [], unsupportedPatterns: [] };
	for (const pattern of normalizeExcludePatterns(excludePatterns ?? [])) {
		const expanded = micromatch.braces(pattern, { expand: true });
		if (expanded.every(isDotnetFormatPath)) {
			scope.excludeArguments.push(...expanded);
		} else {
			scope.unsupportedPatterns.push(pattern);
		}
	}
	return scope;
};

const excludeOption = (scope: DotnetFormatExcludeScope): string[] =>
	scope.excludeArguments.length > 0 ? ["--exclude", ...scope.excludeArguments] : [];

// Run `dotnet format whitespace --verify-no-changes` for one target, returning the
// per-file diagnostics. Failures are swallowed to [] so one unloadable project
// can't sink the whole format pass (mirrors the roslynator lint path). Scoping
// the check to the same excludes the fixer honors keeps a step's before/after
// counts consistent; a pattern dotnet format cannot express is left to
// filterExcludedDiagnostics, which reads nothing but the reported paths.
const checkTarget = async (context: EngineContext, target: string): Promise<Diagnostic[]> => {
	const reportPath = reportPathFor(context.rootDirectory);
	const scope = buildDotnetFormatExcludeScope(context.excludePatterns);
	try {
		await runSubprocess(
			"dotnet",
			[
				"format",
				"whitespace",
				target,
				...excludeOption(scope),
				"--verify-no-changes",
				"--report",
				reportPath,
			],
			{ cwd: context.rootDirectory, timeout: 180000 },
		);
		let json: string;
		try {
			json = fs.readFileSync(reportPath, "utf-8");
			fs.rmSync(reportPath, { force: true });
		} catch {
			return [];
		}
		return parseDotnetFormatReport(json, context.rootDirectory);
	} catch {
		fs.rmSync(reportPath, { force: true });
		return [];
	}
};

export const runDotnetFormat = async (context: EngineContext): Promise<Diagnostic[]> => {
	// Silent restore-evidence gate: the skip notice is the
	// lint pass's job, and format-only skips have no scoring impact to explain.
	const { targets } = findDotnetTargets(context);
	if (targets.length === 0) return [];
	const diagnostics: Diagnostic[] = [];
	const seen = new Set<string>();
	for (const target of targets) {
		for (const diagnostic of await checkTarget(context, target)) {
			// A file shared across targets (sln + member projects) is reported once.
			if (seen.has(diagnostic.filePath)) continue;
			seen.add(diagnostic.filePath);
			diagnostics.push(diagnostic);
		}
	}
	return diagnostics;
};

// Unlike the check pass, this one rewrites files, so it takes the exclude list
// rather than the bare root: excluded projects are dropped from the targets and
// the surviving solution or project pass is scoped with `--exclude`. A pattern
// dotnet format cannot express aborts the run - `aislop fix` must never reformat
// vendored or explicitly excluded code. `runFormattingStep` screens for that
// case first so the user sees the reason instead of a failed step.
export const fixDotnetFormat = async (
	context: Pick<EngineContext, "rootDirectory" | "excludePatterns">,
): Promise<void> => {
	const { rootDirectory } = context;
	const scope = buildDotnetFormatExcludeScope(context.excludePatterns);
	if (scope.unsupportedPatterns.length > 0) {
		throw new Error(
			`dotnet format cannot be scoped to the configured exclude patterns: ${scope.unsupportedPatterns.join(", ")}`,
		);
	}
	const { targets } = findDotnetTargets(context);
	for (const target of targets) {
		const result = await runSubprocess(
			"dotnet",
			["format", "whitespace", target, ...excludeOption(scope)],
			{ cwd: rootDirectory, timeout: 180000 },
		);
		if (result.exitCode !== 0) {
			throw new Error(
				result.stderr || result.stdout || `dotnet format exited with code ${result.exitCode}`,
			);
		}
	}
};
