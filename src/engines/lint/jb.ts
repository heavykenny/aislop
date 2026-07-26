import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectRelativePosix } from "../../utils/paths.js";
import { runSubprocess } from "../../utils/subprocess.js";
import { resolveBundledJbSettings, resolveToolBinary } from "../../utils/tooling.js";
import { findJbTargets, projectsSkippedNotice } from "../dotnet-targets.js";
import type { Diagnostic, EngineContext, Severity } from "../types.js";
import { resolveCppLintConfig } from "./cppcheck.js";
import { decodeEntities, xmlAttribute } from "./xml-entities.js";

export type JbSeverity = "ERROR" | "WARNING" | "SUGGESTION" | "HINT";

interface JbLanguageOptions {
	excludeTypes: Set<string>;
	severityFloor: JbSeverity;
}

interface JbParseOptions {
	csharp: JbLanguageOptions;
	cpp: JbLanguageOptions;
}

const SEVERITY_RANK: Record<JbSeverity, number> = { HINT: 0, SUGGESTION: 1, WARNING: 2, ERROR: 3 };

// jb elevates style nits (e.g. CS9191) to ERROR, so an ERROR is not a bug
// signal. Map ERROR/WARNING to aislop "warning" and the advisory tiers to
// "info"; scoring weights the rest.
const toAislopSeverity = (severity: JbSeverity): Severity =>
	SEVERITY_RANK[severity] >= SEVERITY_RANK.WARNING ? "warning" : "info";

const attribute = (tag: string, name: string): string | null => {
	const value = xmlAttribute(tag, name);
	return value !== null ? decodeEntities(value) : null;
};

const asSeverity = (raw: string | null): JbSeverity =>
	raw === "ERROR" || raw === "SUGGESTION" || raw === "HINT" ? raw : "WARNING";

// Regex parse (no XML dependency, matching dotnet.ts). Builds a TypeId->Severity
// map from <IssueType> tags, then maps each <Issue> tag to a Diagnostic.
// Per-language floors and exclude sets are applied by the "Cpp" prefix test.
export const parseJbXml = (
	xml: string,
	rootDirectory: string,
	options: JbParseOptions,
): Diagnostic[] => {
	try {
		const severityByType = new Map<string, JbSeverity>();
		const typeTagRe = /<IssueType\b[^>]*\/?>/g;
		let typeTag = typeTagRe.exec(xml);
		while (typeTag !== null) {
			const id = attribute(typeTag[0], "Id");
			if (id) severityByType.set(id, asSeverity(attribute(typeTag[0], "Severity")));
			typeTag = typeTagRe.exec(xml);
		}

		const result: Diagnostic[] = [];
		const issueTagRe = /<Issue\b[^>]*\/?>/g;
		let issueTag = issueTagRe.exec(xml);
		while (issueTag !== null) {
			const tag = issueTag[0];
			issueTag = issueTagRe.exec(xml);
			const typeId = attribute(tag, "TypeId");
			const file = attribute(tag, "File");
			if (!typeId || !file) continue;
			const isCpp = typeId.startsWith("Cpp");
			const langOptions = isCpp ? options.cpp : options.csharp;
			if (langOptions.excludeTypes.has(typeId)) continue;
			const severity = severityByType.get(typeId) ?? "WARNING";
			if (SEVERITY_RANK[severity] < SEVERITY_RANK[langOptions.severityFloor]) continue;

			// jb reports File with backslash separators regardless of host OS, and on
			// Linux path.sep never matches them, so normalize before relativizing to
			// keep diagnostic paths forward-slashed on every OS.
			const relative = projectRelativePosix(rootDirectory, file.replace(/\\/g, "/"));
			const lineRaw = attribute(tag, "Line");
			result.push({
				filePath: relative,
				engine: "lint",
				rule: `jb/${typeId}`,
				severity: toAislopSeverity(severity),
				message: attribute(tag, "Message") ?? "",
				help: "",
				line: lineRaw ? Number(lineRaw) : 1,
				column: 1,
				category: isCpp ? "C++ Lint" : "C# Lint",
				fixable: false,
			});
		}
		return result;
	} catch {
		return [];
	}
};

interface CsharpLintConfig {
	jb: boolean;
	roslynator: boolean;
	jbSeverityFloor: JbSeverity;
	jbExcludeTypes: string[];
	jbProjects?: string;
}

const CSHARP_LINT_DEFAULTS: CsharpLintConfig = {
	jb: true,
	roslynator: true,
	jbSeverityFloor: "WARNING",
	jbExcludeTypes: ["InconsistentNaming"],
};

export const resolveCsharpLintConfig = (context: EngineContext): CsharpLintConfig => {
	const raw = context.config.lint.csharp;
	if (!raw) return { ...CSHARP_LINT_DEFAULTS };
	return {
		jb: raw.jb,
		roslynator: raw.roslynator,
		jbSeverityFloor: raw.jbSeverityFloor,
		jbExcludeTypes: raw.jbExcludeTypes,
		jbProjects: raw.jbProjects,
	};
};

// A complete jb report names at least one <Project>. A report with none is the
// partial-cache garbage case (cold cache, stale model), so we discard it rather
// than report a misleading subset. See reference_jb_inspectcode_cache.
const reportLooksComplete = (xml: string): boolean => /<Project\b/.test(xml);

// Pick the lower of two severity floors so the inspectcode pre-filter lets both
// languages' issues through; parseJbXml re-applies each language's floor authoritatively.
const minSeverityFloor = (a: JbSeverity, b: JbSeverity): JbSeverity =>
	SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;

const analyzeJbTarget = async (
	context: EngineContext,
	jb: string,
	settings: string | null,
	parseOptions: JbParseOptions,
	coarseFloor: JbSeverity,
	projectScope: string | undefined,
	includeCpp: boolean,
	target: string,
): Promise<Diagnostic[]> => {
	// Fresh caches every run: jb's result cache survives config edits and a cold
	// cache yields partial reports. Removed in the finally block.
	const cachesHome = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-jb-"));
	const outputPath = path.join(cachesHome, "report.xml");
	try {
		const args = [
			"inspectcode",
			target,
			"--format=Xml",
			`--output=${outputPath}`,
			`--caches-home=${cachesHome}`,
			// Coarse pre-filter only; parseJbXml re-applies per-language floors.
			`--severity=${coarseFloor}`,
		];
		if (settings) args.push(`--settings=${settings}`);
		if (projectScope) args.push(`--project=${projectScope}`);
		// C++ inspection does not require an MSBuild build pass.
		if (includeCpp) args.push("--no-build");
		// jb is slow (solution-wide, with build): allow up to 10 minutes.
		await runSubprocess(jb, args, { cwd: context.rootDirectory, timeout: 600000 });

		let xml: string;
		try {
			xml = fs.readFileSync(outputPath, "utf-8");
		} catch {
			return [];
		}
		if (!reportLooksComplete(xml)) return [];
		return parseJbXml(xml, context.rootDirectory, parseOptions);
	} catch {
		return [];
	} finally {
		fs.rmSync(cachesHome, { recursive: true, force: true });
	}
};

export const buildJbProjectScope = (
	csharpProjects: string | undefined,
	cppProjects: string | undefined,
): string | undefined => {
	const parts = [csharpProjects, cppProjects].filter((p): p is string => !!p && p.length > 0);
	return parts.length > 0 ? parts.join(";") : undefined;
};

export const runJbLint = async (
	context: EngineContext,
	options: { includeCsharp: boolean; includeCpp: boolean },
): Promise<Diagnostic[]> => {
	const selection = findJbTargets(context);
	// Only the C# side owns the notice: a C++-only inspection has no stake in
	// skipped .csproj projects (and would misattribute them to C++ lint).
	const notice = options.includeCsharp
		? projectsSkippedNotice(selection, context.rootDirectory)
		: [];
	if (selection.targets.length === 0) return notice;
	const csharp = resolveCsharpLintConfig(context);
	const cpp = resolveCppLintConfig(context);
	const jbBinary = resolveToolBinary("jb"); // not bundled -> resolves to "jb" on PATH
	const settings = resolveBundledJbSettings();

	const projectScope = buildJbProjectScope(
		options.includeCsharp ? csharp.jbProjects : undefined,
		options.includeCpp ? cpp.jbProjects : undefined,
	);
	const coarseFloor = minSeverityFloor(
		options.includeCsharp ? csharp.jbSeverityFloor : "ERROR",
		options.includeCpp ? cpp.jbSeverityFloor : "ERROR",
	);
	const parseOptions: JbParseOptions = {
		csharp: {
			excludeTypes: new Set(csharp.jbExcludeTypes),
			severityFloor: csharp.jbSeverityFloor,
		},
		cpp: {
			excludeTypes: new Set(cpp.jbExcludeTypes),
			severityFloor: cpp.jbSeverityFloor,
		},
	};

	const diagnostics: Diagnostic[] = [];
	for (const target of selection.targets) {
		diagnostics.push(
			...(await analyzeJbTarget(
				context,
				jbBinary,
				settings,
				parseOptions,
				coarseFloor,
				projectScope,
				options.includeCpp,
				target,
			)),
		);
	}
	return [...diagnostics, ...notice];
};
