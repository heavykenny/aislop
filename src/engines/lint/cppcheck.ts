import os from "node:os";
import path from "node:path";
import { toPosix } from "../../utils/paths.js";
import {
	chunkFilePaths,
	isMissingToolError,
	runSubprocess,
	warnSubprocessFailure,
} from "../../utils/subprocess.js";
import { findCppSources, hasCppOnlySources } from "../cpp-targets.js";
import type { Diagnostic, EngineContext, Severity } from "../types.js";
import type { JbSeverity } from "./jb.js";
import { decodeEntities, xmlAttribute } from "./xml-entities.js";

// cppcheck's own per-invocation overhead (loading suppressions, enabling check
// groups) is higher than clang-format's, so allow more files per chunk before
// the character budget - unchanged from the shared default - becomes binding.
const CPPCHECK_CHUNK_MAX_FILES = 500;

// -j fans a cppcheck invocation out across worker processes instead of running
// single-threaded on one core. Per the cppcheck manual, -j disables
// whole-program analysis (e.g. unusedFunction) unless a build directory
// (--cppcheck-build-dir) is also supplied, because that analysis needs the
// symbol picture from every translation unit at once. Leave two cores free
// since aislop runs its own engines concurrently.
const CPPCHECK_JOB_COUNT = Math.max(1, os.availableParallelism() - 2);

// `--enable` is a free-form, user-configurable comma-separated list (see
// CppLintSchema.cppcheckEnable), not the fixed default - a user can add
// `unusedFunction` or the `all` shorthand (which implies it), either of which
// -j would silently degrade without a build directory (see CPPCHECK_JOB_COUNT
// above). Gate -j on the *effective* list rather than assuming the default.
// Token match, not substring, so an unrelated check id that merely contains
// the text "unusedFunction" cannot false-trigger the gate.
const WHOLE_PROGRAM_ENABLE_TOKENS = new Set(["all", "unusedFunction"]);

const wantsWholeProgramAnalysis = (enable: string): boolean =>
	enable
		.split(",")
		.map((token) => token.trim())
		.some((token) => WHOLE_PROGRAM_ENABLE_TOKENS.has(token));

interface CppLintConfig {
	cppcheck: boolean;
	clangTidy: boolean;
	cppcheckEnable: string;
	jb: boolean;
	jbProjects?: string;
	jbSeverityFloor: JbSeverity;
	jbExcludeTypes: string[];
}

export const CPP_LINT_DEFAULTS: CppLintConfig = {
	cppcheck: true,
	clangTidy: true,
	cppcheckEnable: "warning,performance,portability",
	jb: false,
	jbSeverityFloor: "WARNING",
	jbExcludeTypes: [],
};

export const resolveCppLintConfig = (context: EngineContext): CppLintConfig => {
	const cpp = context.config.lint.cpp;
	if (!cpp) return { ...CPP_LINT_DEFAULTS };
	return {
		cppcheck: cpp.cppcheck,
		clangTidy: cpp.clangTidy,
		cppcheckEnable: cpp.cppcheckEnable,
		jb: cpp.jb,
		jbProjects: cpp.jbProjects,
		jbSeverityFloor: cpp.jbSeverityFloor,
		jbExcludeTypes: cpp.jbExcludeTypes,
	};
};

// cppcheck severities -> aislop severity. `information` is dropped (noise like
// missingInclude); everything actionable maps to error or warning.
const SEVERITY_MAP: Record<string, Severity | undefined> = {
	error: "error",
	warning: "warning",
	performance: "warning",
	portability: "warning",
	style: "warning",
};

// cppcheck self-diagnostics that signal it could not parse a translation unit,
// not a code defect: they fire when a project macro or system header that the
// real compiler has is missing from cppcheck's flag-free view (e.g. the Windows
// `min`/`max` macros, an unknown attribute). cppcheck's own docs say these are
// unreliable without the build's defines/includes, so a standalone scan
// suppresses them rather than scoring clean code as broken. clang-tidy, which
// does run with the compilation database, remains the source of truth for real
// parse errors.
const PARSE_CONTEXT_SUPPRESSIONS = [
	"syntaxError",
	"unknownMacro",
	"internalAstError",
	"internalError",
] as const;

// Build the cppcheck argv. Pass --language=c++ for C++ trees so cppcheck stops
// treating ambiguous `.h` headers as C and rejecting C++ constructs in them.
// `isCppTree` defaults to inferring from `sources` (the historical, unchunked
// behavior); a chunked caller passes the flag decided once from the *whole*
// source set instead, so the language flag stays consistent across chunks
// regardless of how a chunk boundary happens to split C++-only extensions.
export const buildCppcheckArgs = (
	sources: string[],
	config: CppLintConfig,
	isCppTree: boolean = hasCppOnlySources(sources),
): string[] => {
	const args = [`--enable=${config.cppcheckEnable}`, "--inline-suppr", "--quiet"];
	if (!wantsWholeProgramAnalysis(config.cppcheckEnable))
		args.push("-j", String(CPPCHECK_JOB_COUNT));
	if (isCppTree) args.push("--language=c++");
	for (const id of PARSE_CONTEXT_SUPPRESSIONS) args.push(`--suppress=${id}`);
	args.push("--xml", "--xml-version=2", ...sources);
	return args;
};

// True when a chunk-level runSubprocess rejection was the 180s timeout applied
// in runCppcheck below, rather than some other spawn/exit failure.
const isTimeoutError = (error: unknown): boolean =>
	error instanceof Error && /timed out/i.test(error.message);

const relativizeChunkFile = (file: string, rootDirectory: string): string =>
	toPosix(path.isAbsolute(file) ? path.relative(rootDirectory, file) : file);

interface ChunkFailure {
	first: string;
	last: string;
	fileCount: number;
	reason: "timed out" | "failed";
}

// A compact per-chunk identity ("files first..last (N files)") that lets a
// terminal user or the chunks-skipped diagnostic below point at which files
// were dropped, without listing every path in a chunk that can hold hundreds.
const describeChunk = (chunk: string[], rootDirectory: string): Omit<ChunkFailure, "reason"> => ({
	first: relativizeChunkFile(chunk[0], rootDirectory),
	last: relativizeChunkFile(chunk[chunk.length - 1], rootDirectory),
	fileCount: chunk.length,
});

const formatChunkRange = ({ first, last, fileCount }: Omit<ChunkFailure, "reason">): string => {
	const range = first === last ? first : `${first}..${last}`;
	return `files ${range} (${fileCount} file${fileCount === 1 ? "" : "s"})`;
};

const MAX_LISTED_CHUNK_RANGES = 3;

// Builds the single advisory `cppcheck/chunks-skipped` diagnostic summarizing
// every chunk a scan could not analyze, mirroring the dotnet/projects-skipped
// notice: one visible signal for an otherwise-silent gap instead of dropping
// the affected findings without a trace.
const buildChunksSkippedDiagnostic = (
	failures: ChunkFailure[],
	totalChunks: number,
): Diagnostic => {
	const totalFiles = failures.reduce((sum, failure) => sum + failure.fileCount, 0);
	const reasons = new Set(failures.map((failure) => failure.reason));
	const reasonText = reasons.size > 1 ? "some timed out, some failed" : [...reasons][0];
	const listed = failures
		.slice(0, MAX_LISTED_CHUNK_RANGES)
		.map((failure) => formatChunkRange(failure));
	const remaining = failures.length - listed.length;
	const rangeText =
		remaining > 0 ? `${listed.join(", ")}, and ${remaining} more` : listed.join(", ");
	return {
		filePath: failures[0].first,
		engine: "lint",
		rule: "cppcheck/chunks-skipped",
		severity: "info",
		message: `cppcheck skipped ${failures.length} of ${totalChunks} chunk${
			totalChunks === 1 ? "" : "s"
		} (${totalFiles} file${totalFiles === 1 ? "" : "s"} total, ${reasonText}): ${rangeText}`,
		help: "Re-run cppcheck directly on the skipped files, or investigate why the chunk timed out or failed, to recover their findings.",
		line: 0,
		column: 0,
		category: "C++ Lint",
		fixable: false,
	};
};

const attr = (tag: string, name: string): string => xmlAttribute(tag, name) ?? "";

// Defensive regex parse (no XML dependency), mirroring parseRoslynatorXml. cppcheck
// emits each finding as <error ...><location .../></error>; entries without a
// <location> (e.g. whole-program notes) are skipped.
export const parseCppcheckXml = (xml: string, rootDirectory: string): Diagnostic[] => {
	if (!xml || !xml.includes("<error")) return [];
	const out: Diagnostic[] = [];
	for (const block of xml.match(/<error\b[\s\S]*?<\/error>/g) ?? []) {
		const open = /<error\b[^>]*>/.exec(block)?.[0] ?? "";
		const severity = SEVERITY_MAP[attr(open, "severity")];
		if (!severity) continue;
		const loc = /<location\b[^>]*>/.exec(block)?.[0];
		if (!loc) continue;
		const file = attr(loc, "file");
		if (!file) continue;
		out.push({
			filePath: toPosix(path.isAbsolute(file) ? path.relative(rootDirectory, file) : file),
			engine: "lint",
			rule: `cppcheck/${attr(open, "id")}`,
			severity,
			message: decodeEntities(attr(open, "msg")),
			help: "",
			line: Number(attr(loc, "line")) || 1,
			column: Number(attr(loc, "column")) || 1,
			category: "C++ Lint",
			fixable: false,
		});
	}
	return out;
};

// One cppcheck invocation per chunk of sources (see chunkFilePaths): passing every
// discovered C/C++ file to a single invocation can exceed the OS command-line
// length limit on a large enough tree, which fails the spawn outright. Findings
// merge across chunks; chunks are disjoint file sets, and downstream
// dedupeCppDiagnostics already collapses the same (file, line, rule) reported more
// than once - which can happen even within one unchunked invocation, when a shared
// header's issue surfaces once per translation unit that includes it - so chunking
// introduces no new duplication concern.
export const runCppcheck = async (context: EngineContext): Promise<Diagnostic[]> => {
	const sources = findCppSources(context);
	if (sources.length === 0) return [];
	const config = resolveCppLintConfig(context);
	const isCppTree = hasCppOnlySources(sources);
	const diagnostics: Diagnostic[] = [];
	const chunks = chunkFilePaths(sources, CPPCHECK_CHUNK_MAX_FILES);
	const failures: ChunkFailure[] = [];
	for (const chunk of chunks) {
		try {
			// cppcheck writes its XML report to STDERR.
			const result = await runSubprocess("cppcheck", buildCppcheckArgs(chunk, config, isCppTree), {
				cwd: context.rootDirectory,
				timeout: 180000,
			});
			diagnostics.push(...parseCppcheckXml(result.stderr, context.rootDirectory));
		} catch (error) {
			// A missing binary is gated out before this ever runs (installedTools.cppcheck);
			// anything else is cppcheck present but failing, which must not go silent - both
			// the per-chunk stderr warning and the chunks-skipped diagnostic below record it.
			if (isMissingToolError(error)) continue;
			const identity = describeChunk(chunk, context.rootDirectory);
			warnSubprocessFailure(`cppcheck (${formatChunkRange(identity)})`, error);
			failures.push({ ...identity, reason: isTimeoutError(error) ? "timed out" : "failed" });
		}
	}
	if (failures.length > 0) diagnostics.push(buildChunksSkippedDiagnostic(failures, chunks.length));
	return diagnostics;
};
