import type { Diagnostic } from "../types.js";

export const LINE_COMMENT_RE = /^\s*\/\//;

// A catch whose entire body is `throw;` - matched after collapsing whitespace so
// both the single-line and multi-line forms hit. The `\{\s*throw\s*;\s*\}` tail
// requires `throw;` to be the ONLY statement (any preceding stmt or `throw new`
// breaks the match), so log-then-rethrow and wrap-and-rethrow are not flagged.
export const CATCH_ONLY_THROW_RE = /\bcatch\b\s*(?:\([^)]*\))?\s*\{\s*throw\s*;\s*\}/;

// Shared shape for every C# finding - keeps each rule to its detection logic.
export const pushFinding = (
	out: Diagnostic[],
	relPath: string,
	rule: string,
	lineIndex: number,
	message: string,
	help: string,
): void => {
	out.push({
		filePath: relPath,
		engine: "ai-slop",
		rule,
		severity: "warning",
		message,
		help,
		line: lineIndex + 1,
		column: 1,
		category: "AI Slop",
		fixable: false,
	});
};

// Join a short window of lines so a multi-line `catch { ... }` body collapses
// onto one string a single-line regex can match.
export const buildCatchWindow = (lines: string[], i: number): string =>
	lines
		.slice(i, i + 5)
		.join(" ")
		.replace(/\s+/g, " ");

// True when the regex match sits inside a `//` line comment on that line.
export const isInLineComment = (line: string, matchIndex: number): boolean => {
	const commentIndex = line.indexOf("//");
	return commentIndex !== -1 && commentIndex < matchIndex;
};

// Scan each non-comment line against `regex`; emit a finding when it matches and
// the optional `accept` guard (extra context-sensitive checks) returns true.
export const scanLineMatches = (
	lines: string[],
	relPath: string,
	out: Diagnostic[],
	regex: RegExp,
	rule: string,
	message: string,
	help: string,
	accept?: (match: RegExpExecArray, lineIndex: number) => boolean,
): void => {
	for (let i = 0; i < lines.length; i++) {
		if (LINE_COMMENT_RE.test(lines[i])) continue;
		const match = regex.exec(lines[i]);
		if (!match) continue;
		if (accept && !accept(match, i)) continue;
		pushFinding(out, relPath, rule, i, message, help);
	}
};
