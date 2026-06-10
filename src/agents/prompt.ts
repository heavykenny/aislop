import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "../engines/types.js";

const CONTEXT_LINES = 3;
const MAX_DIAGNOSTICS_PER_FILE = 6;
const MAX_FILES = 12;

const priority = (diagnostic: Diagnostic): number => {
	if (diagnostic.severity === "error") return 0;
	if (diagnostic.severity === "warning") return 1;
	return 2;
};

export const selectAgentFindings = (diagnostics: Diagnostic[], limit: number): Diagnostic[] =>
	diagnostics
		.filter((diagnostic) => diagnostic.severity !== "info")
		.sort((a, b) => {
			const severityDelta = priority(a) - priority(b);
			if (severityDelta !== 0) return severityDelta;
			if (a.fixable !== b.fixable) return a.fixable ? 1 : -1;
			return a.filePath.localeCompare(b.filePath);
		})
		.slice(0, Math.max(1, limit));

const groupByFile = (
	diagnostics: Diagnostic[],
): Array<{ filePath: string; diagnostics: Diagnostic[] }> => {
	const groups = new Map<string, Diagnostic[]>();
	for (const diagnostic of diagnostics) {
		const list = groups.get(diagnostic.filePath) ?? [];
		list.push(diagnostic);
		groups.set(diagnostic.filePath, list);
	}
	return [...groups.entries()]
		.map(([filePath, items]) => ({ filePath, diagnostics: items }))
		.slice(0, MAX_FILES);
};

const snippetFor = (rootDirectory: string, diagnostic: Diagnostic): string | null => {
	if (diagnostic.line <= 0) return null;
	const absolutePath = path.resolve(rootDirectory, diagnostic.filePath);
	let content: string;
	try {
		content = fs.readFileSync(absolutePath, "utf-8");
	} catch {
		return null;
	}
	const lines = content.split("\n");
	const start = Math.max(0, diagnostic.line - 1 - CONTEXT_LINES);
	const end = Math.min(lines.length, diagnostic.line + CONTEXT_LINES);
	const out: string[] = [];
	for (let index = start; index < end; index += 1) {
		const lineNumber = index + 1;
		const marker = lineNumber === diagnostic.line ? ">" : " ";
		out.push(`${marker} ${String(lineNumber).padStart(4)} | ${lines[index]}`);
	}
	return out.join("\n");
};

export const buildRepairPrompt = (input: {
	rootDirectory: string;
	findings: Diagnostic[];
	score: number | null;
	targetScore: number;
	maxTurns: number;
}): string => {
	const groups = groupByFile(input.findings);
	const lines: string[] = [
		"You are repairing AI slop findings in a local git worktree.",
		"",
		`Current aislop score: ${input.score == null ? "not scored" : `${input.score}/100`}`,
		`Target score: ${input.targetScore}/100`,
		`Turn budget: ${input.maxTurns}`,
		"",
		"Hard constraints:",
		"- Make the smallest code changes that improve the findings below.",
		"- Do not change public APIs, exports, database schemas, or test expectations unless a finding directly requires it.",
		"- Do not delete tests.",
		"- Do not add dependencies unless the existing project already clearly expects them.",
		"- If a finding looks like a false positive, leave the code alone and mention it in your final summary.",
		"- Run the relevant local verification command if it is obvious and cheap.",
		"",
		"aislop findings to repair:",
		"",
	];

	for (const group of groups) {
		lines.push(`## ${group.filePath}`);
		for (const diagnostic of group.diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE)) {
			const location = diagnostic.line > 0 ? `:${diagnostic.line}` : "";
			lines.push(
				`- ${diagnostic.severity.toUpperCase()} ${diagnostic.rule}${location}: ${diagnostic.message}`,
			);
			if (diagnostic.help) lines.push(`  Help: ${diagnostic.help}`);
			const snippet = snippetFor(input.rootDirectory, diagnostic);
			if (snippet) {
				lines.push("```");
				lines.push(snippet);
				lines.push("```");
			}
		}
		lines.push("");
	}

	if (input.findings.length === 0) {
		lines.push(
			"No findings were supplied. Inspect the codebase for obvious AI slop only if needed.",
		);
	}

	lines.push("After editing, stop and summarize what changed and what you intentionally skipped.");
	return lines.join("\n");
};
