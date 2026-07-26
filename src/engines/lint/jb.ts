import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectRelativePosix } from "../../utils/paths.js";
import { runSubprocess } from "../../utils/subprocess.js";
import { resolveBundledJbSettings, resolveToolBinary } from "../../utils/tooling.js";
import { findJbTargets, projectsSkippedNotice } from "../dotnet-targets.js";
import type { Diagnostic, EngineContext, Severity } from "../types.js";
import { decodeEntities } from "./xml-entities.js";

type JbSeverity = "ERROR" | "WARNING" | "SUGGESTION" | "HINT";

interface JbParseOptions {
	excludeTypes: Set<string>;
	severityFloor: JbSeverity;
}

const SEVERITY_RANK: Record<JbSeverity, number> = { HINT: 0, SUGGESTION: 1, WARNING: 2, ERROR: 3 };

// jb elevates style nits (e.g. CS9191) to ERROR, so an ERROR is not a bug
// signal. Map ERROR/WARNING to aislop "warning" and the advisory tiers to
// "info"; scoring weights the rest.
const toAislopSeverity = (severity: JbSeverity): Severity =>
	SEVERITY_RANK[severity] >= SEVERITY_RANK.WARNING ? "warning" : "info";

const attribute = (tag: string, name: string): string | null => {
	const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
	return match ? decodeEntities(match[1]) : null;
};

const asSeverity = (raw: string | null): JbSeverity =>
	raw === "ERROR" || raw === "SUGGESTION" || raw === "HINT" ? raw : "WARNING";

// Regex parse (no XML dependency, matching dotnet.ts). Builds a TypeId->Severity
// map from <IssueType> tags, then maps each <Issue> tag to a Diagnostic.
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
		const floorRank = SEVERITY_RANK[options.severityFloor];
		const issueTagRe = /<Issue\b[^>]*\/?>/g;
		let issueTag = issueTagRe.exec(xml);
		while (issueTag !== null) {
			const tag = issueTag[0];
			issueTag = issueTagRe.exec(xml);
			const typeId = attribute(tag, "TypeId");
			const file = attribute(tag, "File");
			if (!typeId || !file || options.excludeTypes.has(typeId)) continue;
			const severity = severityByType.get(typeId) ?? "WARNING";
			if (SEVERITY_RANK[severity] < floorRank) continue;

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
				category: "C# Lint",
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

const analyzeJbTarget = async (
	context: EngineContext,
	jb: string,
	settings: string | null,
	csharp: CsharpLintConfig,
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
			// Coarse pre-filter only; parseJbXml re-applies the floor and is authoritative.
			`--severity=${csharp.jbSeverityFloor}`,
		];
		if (settings) args.push(`--settings=${settings}`);
		if (csharp.jbProjects) args.push(`--project=${csharp.jbProjects}`);
		// jb is slow (solution-wide, with build): allow up to 10 minutes.
		await runSubprocess(jb, args, { cwd: context.rootDirectory, timeout: 600000 });

		let xml: string;
		try {
			xml = fs.readFileSync(outputPath, "utf-8");
		} catch {
			return [];
		}
		if (!reportLooksComplete(xml)) return [];
		return parseJbXml(xml, context.rootDirectory, {
			excludeTypes: new Set(csharp.jbExcludeTypes),
			severityFloor: csharp.jbSeverityFloor,
		});
	} catch {
		return [];
	} finally {
		fs.rmSync(cachesHome, { recursive: true, force: true });
	}
};

export const runJbLint = async (context: EngineContext): Promise<Diagnostic[]> => {
	const selection = findJbTargets(context);
	const notice = projectsSkippedNotice(selection, context.rootDirectory);
	if (selection.targets.length === 0) return notice;
	const csharp = resolveCsharpLintConfig(context);
	const jb = resolveToolBinary("jb"); // not bundled -> resolves to "jb" on PATH
	const settings = resolveBundledJbSettings();
	const diagnostics: Diagnostic[] = [];
	for (const target of selection.targets) {
		diagnostics.push(...(await analyzeJbTarget(context, jb, settings, csharp, target)));
	}
	return [...diagnostics, ...notice];
};
