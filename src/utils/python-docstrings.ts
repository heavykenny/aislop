// Shared across ai-slop detectors that need to reason about Python
// triple-quoted strings from plain lines. Two related line sets:
//
// - tripleQuotedStringLines: lines inside any multi-line `"""..."""` /
//   `'''...'''` literal. Use to keep string *content* from being read as
//   executable code (a print() sample inside a code-generation template, for
//   example), regardless of what the string is used for at runtime.
// - docstringLines: the subset whose literal is docstring-positioned - the
//   opening delimiter (after optional r/b/u/f prefix letters) is the first
//   thing on its line, making the string a bare expression statement: a
//   module/class/function docstring (PEP 257), an attribute docstring, or a
//   string used as a block comment. An assigned or call-wrapped literal
//   (`config = """..."""`) is a runtime value and is never in this set.
//   Single-line docstrings (open and close on one line) are included.
//
// Bounded line scanner, not a parser: a triple-quote inside a `#` comment, or
// a value literal whose delimiter starts a continuation line inside an open
// bracket, can misclassify a span. Both shapes are rare, and the failure
// direction is a wrongly widened or narrowed exemption for that span only.

export interface PythonDocstringScan {
	tripleQuotedStringLines: Set<number>;
	docstringLines: Set<number>;
}

const DOCSTRING_OPENER_RE = /^\s*[rRuUbBfF]{0,3}("""|''')/;

export const scanPythonDocstrings = (lines: string[]): PythonDocstringScan => {
	const tripleQuotedStringLines = new Set<number>();
	const docstringLines = new Set<number>();
	let openDelimiter: '"""' | "'''" | null = null;
	let openIsDocstring = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (openDelimiter) {
			tripleQuotedStringLines.add(i);
			if (openIsDocstring) docstringLines.add(i);
			if (line.includes(openDelimiter)) openDelimiter = null;
			continue;
		}
		// The leftmost triple-quote on the line decides which delimiter is live.
		const doubleIndex = line.indexOf('"""');
		const singleIndex = line.indexOf("'''");
		const firstIndex =
			doubleIndex === -1
				? singleIndex
				: singleIndex === -1
					? doubleIndex
					: Math.min(doubleIndex, singleIndex);
		if (firstIndex === -1) continue;
		const delimiter = firstIndex === doubleIndex ? '"""' : "'''";
		const openerMatch = DOCSTRING_OPENER_RE.exec(line);
		const isDocstringPositioned = openerMatch !== null && openerMatch[1] === delimiter;
		const closeIndex = line.indexOf(delimiter, firstIndex + delimiter.length);
		if (closeIndex === -1) {
			openDelimiter = delimiter;
			openIsDocstring = isDocstringPositioned;
			tripleQuotedStringLines.add(i);
			if (isDocstringPositioned) docstringLines.add(i);
		} else if (isDocstringPositioned) {
			// Single-line docstring: opens and closes on the same line. A closed
			// same-line pair that is NOT docstring-positioned stays untracked:
			// its interior shares the line with the code that owns it, so
			// line-anchored consumers already see that code.
			tripleQuotedStringLines.add(i);
			docstringLines.add(i);
		}
	}
	return { tripleQuotedStringLines, docstringLines };
};
