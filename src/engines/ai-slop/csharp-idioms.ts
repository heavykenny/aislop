// Idiom-level C# rules (cf. the Python idiom layer): broad catch, LINQ Count,
// index-for loops, if/else ladders and string concatenation in loops.
import { maskStringsAndComments } from "../../utils/source-masker.js";
import type { Diagnostic } from "../types.js";
import {
	buildCatchWindow,
	CATCH_ONLY_THROW_RE,
	isInLineComment,
	pushFinding,
	scanLineMatches,
} from "./csharp-shared.js";

const IF_LADDER_THRESHOLD = 4;

// `catch (Exception ...)` / `catch (System.Exception ...)` - the broadest typed
// catch. A `when (...)` filter is a deliberate narrowing and is exempt.
const BROAD_CATCH_RE = /\bcatch\s*\(\s*(?:System\.)?Exception\b/;
const CATCH_WHEN_FILTER_RE = /\bwhen\b/;
const BROAD_CATCH_EMPTY_RE = /\bcatch\b\s*\(\s*(?:System\.)?Exception\b[^)]*\)\s*\{\s*\}/;
// The caught exception variable, when the clause declares one (`catch (Exception ex)`).
const BROAD_CATCH_VAR_RE = /\bcatch\s*\(\s*(?:System\.)?Exception\s+([A-Za-z_]\w*)\s*\)/;
// The `catch (...) {` opening, allowing the brace on a following line (Allman style).
const CATCH_BODY_OPEN_RE = /\bcatch\s*\([^)]*\)\s*\{/;

// Body of a `{ ... }` block by brace matching from its opening brace. Interpolation
// braces in `$"..."` are balanced so naive counting handles them; a lone brace inside
// a string or char literal is the only mis-count risk and is vanishingly rare in a
// catch body.
const extractBlockBody = (content: string, openBraceIndex: number): string | null => {
	let depth = 0;
	for (let i = openBraceIndex; i < content.length; i++) {
		const character = content[i];
		if (character === "{") depth += 1;
		else if (character === "}") {
			depth -= 1;
			if (depth === 0) return content.slice(openBraceIndex + 1, i);
		}
	}
	return null;
};

// A broad catch surfaces (rather than buries) the error when its body references the
// caught exception variable - logging it, wrapping it, or otherwise keeping the failure
// diagnosable. This is the same bar python-broad-except applies: it flags only silent
// `pass` bodies, not logged ones. A catch with no variable, or one whose variable is
// never used, drops the error and stays flagged. The variable is block-scoped, so the
// body is brace-matched to avoid crediting a reference in a sibling catch.
const broadCatchSurfacesError = (lines: string[], catchLineIndex: number): boolean => {
	const variableMatch = BROAD_CATCH_VAR_RE.exec(lines[catchLineIndex]);
	if (!variableMatch) return false;
	const content = lines.slice(catchLineIndex).join("\n");
	const openMatch = CATCH_BODY_OPEN_RE.exec(content);
	if (!openMatch) return false;
	const openBraceIndex = openMatch.index + openMatch[0].length - 1;
	const body = extractBlockBody(content, openBraceIndex);
	if (body === null) return false;
	return new RegExp(`\\b${variableMatch[1]}\\b`).test(body);
};

// A broad `catch (Exception)` that drops the failure buries problems you didn't plan
// for. Empty and pure-rethrow broad catches are covered by swallowed-exception and
// csharp-empty-catch-rethrow; a catch-and-log boundary (the body references the caught
// exception) is observable recovery, matching python-broad-except - so skip those here.
export const flagBroadCatch = (lines: string[], relPath: string, out: Diagnostic[]): void => {
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim().startsWith("//")) continue;
		if (!BROAD_CATCH_RE.test(lines[i])) continue;
		if (CATCH_WHEN_FILTER_RE.test(lines[i])) continue;
		const window = buildCatchWindow(lines, i);
		if (CATCH_ONLY_THROW_RE.test(window)) continue;
		if (BROAD_CATCH_EMPTY_RE.test(window)) continue;
		if (broadCatchSurfacesError(lines, i)) continue;
		pushFinding(
			out,
			relPath,
			"ai-slop/csharp-broad-catch",
			i,
			"`catch (Exception)` catches everything and drops the failure - the specific problems you didn't plan for vanish.",
			"Catch the specific exception type(s) you can handle and let the rest propagate. At a deliberate boundary, log the caught exception (or add a `when` filter) so the failure stays diagnosable instead of disappearing.",
		);
	}
};

// `.Count() <op> 0|1` (or the reversed form) - enumerating a sequence just to ask
// "are there any?". `\b[01]\b` avoids matching the digits inside larger numbers.
const LINQ_COUNT_RE =
	/\.Count\s*\(\s*\)\s*(?:==|!=|>=|<=|>|<)\s*\b[01]\b|\b[01]\b\s*(?:==|!=|>=|<=|>|<)\s*[A-Za-z_][\w.]*\.Count\s*\(\s*\)/;

export const flagLinqCount = (lines: string[], relPath: string, out: Diagnostic[]): void => {
	scanLineMatches(
		lines,
		relPath,
		out,
		LINQ_COUNT_RE,
		"ai-slop/csharp-linq-count",
		"`.Count()` compared to 0/1 walks the whole sequence just to ask whether any element exists.",
		"Use `.Any()` (or `!collection.Any()` for the empty check) instead of `.Count() > 0` / `.Count() == 0`.",
		(match, i) => !isInLineComment(lines[i], match.index),
	);
};

// Index `for` loop walking `.Length`/`.Count` with the same counter throughout -
// the canonical shape that reads more clearly as `foreach`.
const INDEX_FOR_RE =
	/\bfor\s*\(\s*(?:int|long|uint|nint|var)\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*[A-Za-z_][\w.]*\.(?:Length|Count)\b[^;]*;\s*\1\s*(?:\+\+|\+=\s*1)/;

// Body of the `for` loop starting on `forLineIndex`, whether a `{ }` block or a single
// braceless statement. The header's own parentheses (e.g. a `.Count()` call) are matched
// past before the body is read.
const extractLoopBody = (lines: string[], forLineIndex: number): string | null => {
	const content = lines.slice(forLineIndex).join("\n");
	const forIndex = content.search(/\bfor\s*\(/);
	if (forIndex === -1) return null;
	let depth = 0;
	let i = content.indexOf("(", forIndex);
	for (; i < content.length; i++) {
		if (content[i] === "(") depth += 1;
		else if (content[i] === ")") {
			depth -= 1;
			if (depth === 0) {
				i += 1;
				break;
			}
		}
	}
	while (i < content.length && /\s/.test(content[i])) i += 1;
	if (content[i] === "{") return extractBlockBody(content, i);
	const semicolon = content.indexOf(";", i);
	return semicolon === -1 ? content.slice(i) : content.slice(i, semicolon + 1);
};

// True when the loop counter is only ever a `collection[index]` subscript - the shape a
// `foreach` expresses more clearly. If the index is used for anything else (a nested
// `j = i + 1` look-ahead, arithmetic, logging, an argument), `foreach` cannot express it,
// so the loop is left alone. Mirrors the rule's own "if the index itself is used, ignore
// this" guidance, which the line-only match could not honor.
const indexUsedOnlyForElementAccess = (
	lines: string[],
	forLineIndex: number,
	indexName: string,
): boolean => {
	const body = extractLoopBody(lines, forLineIndex);
	if (body === null) return true;
	const withoutSubscripts = body.replace(new RegExp(`\\[\\s*${indexName}\\s*\\]`, "g"), "");
	return !new RegExp(`\\b${indexName}\\b`).test(withoutSubscripts);
};

export const flagIndexLoop = (lines: string[], relPath: string, out: Diagnostic[]): void => {
	scanLineMatches(
		lines,
		relPath,
		out,
		INDEX_FOR_RE,
		"ai-slop/csharp-index-loop",
		"Index `for` loop over `.Length`/`.Count` is usually clearer as `foreach`.",
		"Use `foreach (var item in collection)` when you don't need the index. If the index itself is used, ignore this.",
		(match, i) =>
			!isInLineComment(lines[i], match.index) && indexUsedOnlyForElementAccess(lines, i, match[1]),
	);
};

// if/else-if ladder comparing one value against constants - a switch in disguise.
const IF_LADDER_BRANCH_RE =
	/^\s*(?:\}\s*)?(?:else\s+)?if\s*\(\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*==\s*(?:"[^"]*"|'[^']*'|[\w.]+)\s*\)/;
const ELSE_IF_RE = /\belse\s+if\b/;

// Walk consecutive if/else-if branches that compare the SAME value; a chain of
// IF_LADDER_THRESHOLD+ is a switch (or handler map) wearing an if/else costume.
export const flagIfLadder = (lines: string[], relPath: string, out: Diagnostic[]): void => {
	let chainVariable: string | null = null;
	let count = 0;
	let startLine = 0;
	const finalize = (): void => {
		if (chainVariable !== null && count >= IF_LADDER_THRESHOLD) {
			pushFinding(
				out,
				relPath,
				"ai-slop/csharp-if-ladder",
				startLine,
				`${count} repeated if/else-if branches dispatch on \`${chainVariable}\`.`,
				"Use a `switch` (or a lookup/handler map) when each branch compares the same value against a constant.",
			);
		}
		chainVariable = null;
		count = 0;
	};
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim().startsWith("//")) continue;
		const match = IF_LADDER_BRANCH_RE.exec(lines[i]);
		if (!match) continue;
		const variable = match[1];
		if (ELSE_IF_RE.test(lines[i]) && chainVariable === variable) {
			count++;
			continue;
		}
		finalize();
		chainVariable = variable;
		count = 1;
		startLine = i;
	}
	finalize();
};

const LOOP_HEADER_RE = /\b(?:for|foreach|while)\s*\(|\bdo\b/;
// `<name> += ... "<literal>"` - a `+=` whose right-hand side contains a string
// literal/interpolation, so we only flag concatenations we can SEE are string-typed.
const STRING_CONCAT_RE = /(\w+)\s*\+=\s*[^;]*"/;

// `s += "..."` inside a loop rebuilds the entire string each iteration (O(n^2)).
// Loop bodies are tracked by brace depth (strings/comments stripped first); the
// `{` may sit on the loop-header line or the next line, both handled.
export const flagStringConcatInLoop = (
	lines: string[],
	relPath: string,
	out: Diagnostic[],
	content: string,
): void => {
	// Braces or loop keywords *inside* string/char literals and comments would skew
	// the brace-depth tracking below, so mask them out up front. maskStringsAndComments
	// preserves line count (masked regions become spaces, newlines are untouched), so
	// indexing maskedLines[i] lines up with the original lines[i].
	const maskedLines = maskStringsAndComments(content, ".cs").split("\n");
	let braceDepth = 0;
	const loopBodyDepths: number[] = [];
	let pendingLoop = false;
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		if (raw.trim().startsWith("//")) continue;
		const code = maskedLines[i];

		if (loopBodyDepths.length > 0) {
			const match = STRING_CONCAT_RE.exec(raw);
			if (match && !isInLineComment(raw, match.index)) {
				pushFinding(
					out,
					relPath,
					"ai-slop/csharp-string-concat-in-loop",
					i,
					`\`${match[1]} += ...\` inside a loop reallocates the whole string each iteration (O(n^2)).`,
					"Build the result with a `StringBuilder` (append in the loop, `.ToString()` after) instead of `+=` concatenation.",
				);
			}
		}

		if (LOOP_HEADER_RE.test(code)) pendingLoop = true;

		let openedBrace = false;
		for (const char of code) {
			if (char === "{") {
				braceDepth++;
				openedBrace = true;
				if (pendingLoop) {
					loopBodyDepths.push(braceDepth);
					pendingLoop = false;
				}
			} else if (char === "}") {
				const idx = loopBodyDepths.indexOf(braceDepth);
				if (idx !== -1) loopBodyDepths.splice(idx, 1);
				if (braceDepth > 0) braceDepth--;
			}
		}
		// A single-statement loop body (e.g. `for (...) Foo();` with no brace block) -
		// drop the pending flag so it can't wrongly mark the next braced block as a loop.
		if (pendingLoop && !openedBrace && code.includes(";")) pendingLoop = false;
	}
};
