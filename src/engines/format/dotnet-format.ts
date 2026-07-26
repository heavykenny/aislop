import fs from "node:fs";
import path from "node:path";
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

// Run `dotnet format whitespace --verify-no-changes` for one target, returning the
// per-file diagnostics. Failures are swallowed to [] so one unloadable project
// can't sink the whole format pass (mirrors the roslynator lint path).
const checkTarget = async (context: EngineContext, target: string): Promise<Diagnostic[]> => {
	const reportPath = reportPathFor(context.rootDirectory);
	try {
		await runSubprocess(
			"dotnet",
			["format", "whitespace", target, "--verify-no-changes", "--report", reportPath],
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

export const fixDotnetFormat = async (rootDirectory: string): Promise<void> => {
	const { targets } = findDotnetTargets({ rootDirectory });
	for (const target of targets) {
		const result = await runSubprocess("dotnet", ["format", "whitespace", target], {
			cwd: rootDirectory,
			timeout: 180000,
		});
		if (result.exitCode !== 0) {
			throw new Error(
				result.stderr || result.stdout || `dotnet format exited with code ${result.exitCode}`,
			);
		}
	}
};
