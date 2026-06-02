import fs from "node:fs";
import path from "node:path";
import type { EngineContext } from "../types.js";
import { detectTrivialComments } from "./comments.js";
import { detectDeadPatterns } from "./dead-patterns.js";

/**
 * Given a starting line that contains an opening `(`, find all lines
 * through the matching `)`. Returns the set of 1-based line numbers.
 */
const findStatementSpan = (lines: string[], startIndex: number): Set<number> => {
	const span = new Set<number>();
	let depth = 0;
	let started = false;

	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i];
		span.add(i + 1);

		for (const ch of line) {
			if (ch === "(") {
				depth++;
				started = true;
			} else if (ch === ")") {
				depth--;
			}
		}

		if (started && depth <= 0) {
			break;
		}
	}

	return span;
};

/**
 * Patterns that indicate a console.log is communicating an error or important
 * status to the user — should be upgraded to console.error, not removed.
 */
const ERROR_MESSAGE_PATTERNS = [
	/\b(?:error|err|fail|failed|failure|fatal|crash|exception)\b/i,
	/\b(?:not found|missing|invalid|unable|cannot|couldn'?t|won'?t)\b/i,
	/\b(?:denied|unauthorized|forbidden|refused|rejected|timeout|timed?\s*out)\b/i,
	/\bno\s+(?:\w+\s+)*found\b/i,
	/\bprocess\.exit\b/,
];

/**
 * Extracts the full text of a console statement spanning multiple lines.
 */
const getStatementText = (lines: string[], span: Set<number>): string => {
	const spanLines: string[] = [];
	for (const lineNo of span) {
		spanLines.push(lines[lineNo - 1]);
	}
	return spanLines.join("\n");
};

/**
 * Determine if a console.log should be replaced with console.error
 * rather than removed entirely.
 */
const shouldUpgradeToError = (statementText: string): boolean => {
	return ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(statementText));
};

// In diagnostic scripts the console output is the point, so do not strip it.
const DIAGNOSTIC_PATH_RE =
	/(?:^|\/)(?:tools|scripts|cli|bin)\/|(?:^|\/)test-[^/]*\.[tj]sx?$|[.-](?:test|spec)\.[tj]sx?$/i;
const isDiagnosticScriptPath = (filePath: string): boolean =>
	DIAGNOSTIC_PATH_RE.test(filePath.replace(/\\/g, "/"));

const firstNonBlank = (lines: string[], from: number, step: number, skip: Set<number>): string => {
	for (let i = from; i >= 0 && i < lines.length; i += step) {
		if (skip.has(i + 1)) continue;
		if (lines[i].trim() !== "") return lines[i].trim();
	}
	return "";
};

// Removing every statement in a block guts the function, so leave it for a human.
// `removed` is every line already scheduled to go, so two consoles in one block both skip.
const wouldEmptyEnclosingBlock = (
	lines: string[],
	span: Set<number>,
	removed: Set<number>,
): boolean => {
	const sorted = [...span].sort((a, b) => a - b);
	const before = firstNonBlank(lines, sorted[0] - 2, -1, removed);
	const after = firstNonBlank(lines, sorted[sorted.length - 1], 1, removed);
	return before.endsWith("{") && after.startsWith("}");
};

export const fixDeadPatterns = async (context: EngineContext): Promise<void> => {
	const diagnostics = [
		...(await detectTrivialComments(context)),
		...(await detectDeadPatterns(context)),
	];

	const fixable = diagnostics.filter((d) => d.fixable);
	if (fixable.length === 0) return;

	const byFile = new Map<string, { line: number; rule: string }[]>();
	for (const d of fixable) {
		const absolute = path.isAbsolute(d.filePath)
			? d.filePath
			: path.join(context.rootDirectory, d.filePath);
		const entries = byFile.get(absolute) ?? [];
		entries.push({ line: d.line, rule: d.rule });
		byFile.set(absolute, entries);
	}

	for (const [filePath, entries] of byFile) {
		fixFileDeadPatterns(filePath, entries, context.rootDirectory);
	}
};

const fixFileDeadPatterns = (
	filePath: string,
	entries: { line: number; rule: string }[],
	rootDirectory: string,
): void => {
	if (!fs.existsSync(filePath)) return;

	const content = fs.readFileSync(filePath, "utf-8");
	const lines = content.split("\n");
	const linesToRemove = new Set<number>();
	const lineReplacements = new Map<number, string>();

	// Match diagnostic dirs inside the project, not parent dirs of the checkout.
	const skipConsole = isDiagnosticScriptPath(path.relative(rootDirectory, filePath));

	const consoleSpans: Set<number>[] = [];
	for (const entry of entries) {
		const index = entry.line - 1;
		if (index < 0 || index >= lines.length) continue;

		if (entry.rule === "ai-slop/console-leftover") {
			if (skipConsole) continue;
			const span = findStatementSpan(lines, index);
			const statementText = getStatementText(lines, span);

			if (shouldUpgradeToError(statementText)) {
				lineReplacements.set(
					entry.line,
					lines[index].replace(
						/console\.(?:log|debug|info|trace|dir|table)\s*\(/,
						"console.error(",
					),
				);
			} else {
				consoleSpans.push(span);
			}
		} else {
			linesToRemove.add(entry.line);
		}
	}

	// Drop any console whose removal would empty its block, counting the other
	// scheduled console removals so multiple logs in one block all stay.
	const candidateLines = new Set<number>();
	for (const span of consoleSpans) {
		for (const lineNo of span) candidateLines.add(lineNo);
	}
	for (const span of consoleSpans) {
		if (wouldEmptyEnclosingBlock(lines, span, candidateLines)) continue;
		for (const lineNo of span) linesToRemove.add(lineNo);
	}

	const result = applyEditsAndCollapse(lines, linesToRemove, lineReplacements);
	fs.writeFileSync(filePath, result);
};

const applyEditsAndCollapse = (
	lines: string[],
	linesToRemove: Set<number>,
	lineReplacements: Map<number, string>,
): string => {
	const result: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const lineNo = i + 1;
		if (linesToRemove.has(lineNo)) continue;
		result.push(lineReplacements.get(lineNo) ?? lines[i]);
	}

	const collapsed: string[] = [];
	for (const line of result) {
		const prevEmpty = collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === "";
		if (line.trim() === "" && prevEmpty) continue;
		collapsed.push(line);
	}

	return collapsed.join("\n");
};
