import fs from "node:fs";
import path from "node:path";
import { projectRelativePosix } from "../../utils/paths.js";
import { runSubprocess } from "../../utils/subprocess.js";
import { resolveBundledAnalyzerAssemblies, resolveToolBinary } from "../../utils/tooling.js";
import { findDotnetTargets, projectsSkippedNotice } from "../dotnet-targets.js";
import type { Diagnostic, EngineContext } from "../types.js";
import { decodeEntities } from "./xml-entities.js";

// Diagnostic IDs from the bundled analyzers that map onto aislop's AI-slop thesis.
const RELEVANT_IDS = new Set([
	"AsyncFixer01",
	"AsyncFixer02",
	"AsyncFixer03", // async misuse / sync-over-async
	"MA0040",
	"MA0042",
	"MA0045", // Meziantou async/Task best practices
	"CS0219",
	"CS0162", // unused/unreachable
	"IDISP001", // IDisposableAnalyzers: a created IDisposable is never disposed (resource leak)
]);

interface ParsedDiagnostic {
	id: string;
	message: string;
	filePath: string;
	line: number;
	column: number;
}

// Defensive regex parse (no XML dependency). Matches each <Diagnostic Id="..."> ... </Diagnostic>.
// Summary-section entries have no <FilePath> and are skipped.
const extractDiagnostics = (xml: string): ParsedDiagnostic[] => {
	const result: ParsedDiagnostic[] = [];
	const blockRe = /<Diagnostic\b[^>]*\bId="([^"]+)"[\s\S]*?<\/Diagnostic>/g;
	let block = blockRe.exec(xml);
	while (block !== null) {
		const id = block[1];
		const body = block[0];
		const message = /<Message>([\s\S]*?)<\/Message>/.exec(body)?.[1] ?? "";
		const filePath = /<FilePath>([\s\S]*?)<\/FilePath>/.exec(body)?.[1] ?? "";
		const location = /<Location\b[^>]*\bLine="(\d+)"[^>]*\bCharacter="(\d+)"/.exec(body);
		block = blockRe.exec(xml);
		if (!filePath) continue;
		result.push({
			id,
			message: decodeEntities(message.trim()),
			filePath: decodeEntities(filePath.trim()),
			line: location ? Number(location[1]) : 1,
			column: location ? Number(location[2]) : 1,
		});
	}
	return result;
};

export const parseRoslynatorXml = (xml: string, rootDirectory: string): Diagnostic[] => {
	let parsed: ParsedDiagnostic[];
	try {
		parsed = extractDiagnostics(xml);
	} catch {
		return [];
	}
	return parsed
		.filter((d) => RELEVANT_IDS.has(d.id))
		.map((d) => ({
			filePath: projectRelativePosix(rootDirectory, d.filePath),
			engine: "lint" as const,
			rule: `dotnet/${d.id}`,
			severity: "warning" as const,
			message: d.message,
			help: "",
			line: d.line,
			column: d.column,
			category: "C# Lint",
			fixable: false,
		}));
};

// Restore + roslynator-analyze a single .sln/.csproj target, returning the
// relevant diagnostics. Failures are swallowed to [] so one unloadable project
// can't sink the whole lint pass.
const analyzeTarget = async (
	context: EngineContext,
	roslynator: string,
	analyzerAssemblies: string[],
	target: string,
): Promise<Diagnostic[]> => {
	const outputPath = path.join(context.rootDirectory, ".aislop-roslynator.xml");
	try {
		// Best-effort restore; ignore failure (analyze surfaces nothing if it can't load).
		await runSubprocess("dotnet", ["restore", target], {
			cwd: context.rootDirectory,
			timeout: 120000,
		});
		const analyzeArgs = ["analyze", target, "--output", outputPath];
		if (analyzerAssemblies.length > 0) {
			analyzeArgs.push("--analyzer-assemblies", ...analyzerAssemblies);
		}
		// Parse whatever output is produced: roslynator's exit code varies with the
		// highest diagnostic severity, so the written XML (not the code) is the signal.
		await runSubprocess(roslynator, analyzeArgs, {
			cwd: context.rootDirectory,
			timeout: 180000,
		});
		let xml: string;
		try {
			xml = fs.readFileSync(outputPath, "utf-8");
			fs.rmSync(outputPath, { force: true });
		} catch {
			return [];
		}
		return parseRoslynatorXml(xml, context.rootDirectory);
	} catch {
		return [];
	}
};

export const runDotnetLint = async (context: EngineContext): Promise<Diagnostic[]> => {
	const selection = findDotnetTargets(context);
	const notice = projectsSkippedNotice(selection, context.rootDirectory);
	if (selection.targets.length === 0) return notice;
	const roslynator = resolveToolBinary("roslynator");
	// Bundled analyzers extend coverage to projects that don't reference them;
	// when none are bundled, roslynator still runs the project's own analyzers.
	const analyzerAssemblies = resolveBundledAnalyzerAssemblies();
	const diagnostics: Diagnostic[] = [];
	for (const target of selection.targets) {
		diagnostics.push(...(await analyzeTarget(context, roslynator, analyzerAssemblies, target)));
	}
	return [...diagnostics, ...notice];
};
