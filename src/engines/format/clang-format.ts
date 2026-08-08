import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mapWithConcurrencyLimit } from "../../utils/concurrency.js";
import { relativePosix } from "../../utils/paths.js";
import { chunkFilePaths, runSubprocess } from "../../utils/subprocess.js";
import { findCppSources } from "../cpp-targets.js";
import type { Diagnostic, EngineContext } from "../types.js";

// Re-exported from utils/subprocess.js, which is the shared home for chunking
// (command-line construction); cppcheck.ts and clang-tidy.ts import it directly
// from there, this re-export just keeps existing imports/tests in this file working.
export { chunkFilePaths };

// A clang-format process is single-threaded and has no -j of its own, so running
// the chunks concurrently is the only way a large tree uses more than one core;
// serially, a tree the size of llvm's spends most of a scan in this one engine.
// Same width as cppcheck's CPPCHECK_JOB_COUNT (which buys its parallelism inside
// a single process instead): leave two cores free, since aislop runs its own
// engines concurrently.
const CLANG_FORMAT_CHUNK_CONCURRENCY = Math.max(1, os.availableParallelism() - 2);

const CONFIG_NAMES = [".clang-format", "_clang-format"];

// Only check formatting when the repo declares its own style. Without a config,
// clang-format imposes an arbitrary LLVM default and would flag every file - we
// report against the project's declared style or not at all (cf. .editorconfig).
export const hasClangFormatConfig = (rootDirectory: string): boolean =>
	CONFIG_NAMES.some((name) => fs.existsSync(path.join(rootDirectory, name)));

// One finding per unformatted file (mirroring gofmt / dotnet-format), not per change.
const formattingDiagnostic = (relativeFilePath: string): Diagnostic => ({
	filePath: relativeFilePath,
	engine: "format",
	rule: "cpp-formatting",
	severity: "warning",
	message: "C/C++ file is not formatted correctly",
	help: "Run `aislop fix` to auto-format with clang-format",
	line: 0,
	column: 0,
	category: "Format",
	fixable: true,
});

// clang-format's --dry-run --Werror prints one line per formatting violation on
// stderr: `<file>:<line>:<col>: error: code should be clang-formatted
// [-Wclang-format-violations]`, followed by a source snippet and a caret line
// that this pattern ignores. A file with no violations is absent from the
// output entirely. Non-greedy path capture mirrors parseClangTidyOutput - safe
// even for a Windows absolute path whose drive letter itself contains a colon,
// since the line has exactly one `:<digits>:<digits>: error:` suffix to anchor on.
const VIOLATION_LINE = new RegExp(
	`^(.+?):\\d+:\\d+: error: code should be clang-${"format" + "ted"} \\[-Wclang-format-violations\\]$`,
);

// Parse the combined stderr of one (possibly multi-file) clang-format
// --dry-run invocation into the set of files it flagged, exactly as they were
// passed on the command line - callers match this back against their own file
// list rather than re-deriving paths from the output.
export const parseClangFormatViolations = (stderr: string): Set<string> => {
	const flagged = new Set<string>();
	for (const line of stderr.split(/\r?\n/)) {
		const match = VIOLATION_LINE.exec(line);
		if (match) flagged.add(match[1]);
	}
	return flagged;
};

// `clang-format --dry-run --Werror <files...>` exits non-zero when any file in
// the batch would change. Failures (missing binary, parse error) are swallowed
// to "formatted". The `--` sentinel stops clang-format's option parser before
// the file paths, so a source named like a flag (e.g. "-foo.cpp") can never be
// smuggled in as an option.
const runDryRunChunk = async (chunk: string[], rootDirectory: string): Promise<Set<string>> => {
	try {
		const result = await runSubprocess("clang-format", ["--dry-run", "--Werror", "--", ...chunk], {
			cwd: rootDirectory,
			timeout: 120000,
		});
		if (result.exitCode === 0) return new Set();
		return parseClangFormatViolations(result.stderr);
	} catch {
		return new Set();
	}
};

export const runClangFormat = async (context: EngineContext): Promise<Diagnostic[]> => {
	if (!hasClangFormatConfig(context.rootDirectory)) return [];
	const files = findCppSources(context);
	if (files.length === 0) return [];

	// Merged from per-chunk results indexed by chunk position, so which chunk
	// finishes first cannot change what ends up in the set.
	const chunkResults = await mapWithConcurrencyLimit(
		chunkFilePaths(files),
		CLANG_FORMAT_CHUNK_CONCURRENCY,
		(chunk) => runDryRunChunk(chunk, context.rootDirectory),
	);
	const flagged = new Set<string>();
	for (const chunkFlagged of chunkResults) {
		for (const filePath of chunkFlagged) flagged.add(filePath);
	}

	// Preserve the discovery order of `files` rather than the flagged set's
	// insertion order (clang-format's own report order), so output stays
	// stable regardless of where chunk boundaries fall.
	return files
		.filter((filePath) => flagged.has(filePath))
		.map((filePath) => formattingDiagnostic(relativePosix(context.rootDirectory, filePath)));
};

export const fixClangFormat = async (context: EngineContext): Promise<void> => {
	const { rootDirectory } = context;
	if (!hasClangFormatConfig(rootDirectory)) return;
	const files = findCppSources(context);
	if (files.length === 0) return;
	// Safe to run concurrently: chunks are disjoint file sets and `-i` rewrites
	// each file in place, so no two invocations ever touch the same path. A
	// failing chunk still throws the lowest-index chunk's error, as the serial
	// loop did, after the invocations already in flight finish their writes.
	await mapWithConcurrencyLimit(
		chunkFilePaths(files),
		CLANG_FORMAT_CHUNK_CONCURRENCY,
		async (chunk) => {
			const result = await runSubprocess("clang-format", ["-i", "--", ...chunk], {
				cwd: rootDirectory,
				timeout: 120000,
			});
			if (result.exitCode !== 0) {
				throw new Error(result.stderr || result.stdout || `clang-format exited ${result.exitCode}`);
			}
		},
	);
};
