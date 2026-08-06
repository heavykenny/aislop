// Low-level scanners that find where a source string literal ends. The maskers
// in source-masker.ts use these to skip literal bodies without letting braces,
// comment markers or keywords inside them leak into structural analysis.

interface LiteralSpan {
	// First index of the literal body, with the opening delimiter excluded.
	bodyStart: number;
	// Index just past the last body character.
	bodyEnd: number;
	// Index to resume scanning from, just past the closing delimiter.
	resumeAt: number;
}

// Consume a quoted string starting at the opening quote. Returns the index
// just past the closing quote (or end-of-content if unterminated). Backslash
// escapes the next character; a newline ends an unterminated literal.
export const consumeQuotedString = (content: string, start: number, quote: string): number => {
	const len = content.length;
	let i = start + 1;
	while (i < len) {
		const c = content[i];
		if (c === "\\" && i + 1 < len) {
			i += 2;
			continue;
		}
		if (c === quote) return i + 1;
		if (c === "\n") return i; // unterminated, bail
		i++;
	}
	return i;
};

// Length of the run of consecutive `character` starting at `start`.
const runLength = (content: string, start: number, character: string): number => {
	let i = start;
	while (content[i] === character) i++;
	return i - start;
};

// Skip the expression inside an interpolation hole. It can hold nested string
// and character literals, and a quote inside one of those must not be read as
// the end of the enclosing literal. `openLength` is how many braces open a
// hole, which is the number of `$` in the literal's prefix. Returns -1 when
// the hole never closes.
const consumeInterpolationHole = (
	content: string,
	open: number,
	openLength: number,
	multiline: boolean,
): number => {
	const len = content.length;
	let depth = openLength;
	let i = open + openLength;
	while (i < len) {
		const c = content[i];
		if (c === "\n" && !multiline) return -1;
		if (c === '"' || c === "$" || c === "@") {
			const nested = csharpStringAt(content, i);
			if (nested) {
				i = nested.resumeAt;
				continue;
			}
		}
		if (c === "'") {
			i = consumeQuotedString(content, i, "'");
			continue;
		}
		if (c === "{" || c === "}") {
			const run = runLength(content, i, c);
			depth += c === "{" ? run : -run;
			i += run;
			if (depth <= 0) return i;
			continue;
		}
		i++;
	}
	return -1;
};

// Advance past a `{` run in a plain or verbatim interpolated string, where a
// doubled brace is one literal brace and a lone brace opens a hole. A hole
// that never closes means the source does not compile and the brace is better
// read as literal text, so resume just past it instead of consuming the rest
// of the file as an expression.
const skipBraceRun = (content: string, start: number, multiline: boolean): number => {
	const run = runLength(content, start, "{");
	const literalEnd = start + run - (run % 2);
	if (run % 2 === 0) return literalEnd;
	const holeEnd = consumeInterpolationHole(content, literalEnd, 1, multiline);
	return holeEnd === -1 ? literalEnd + 1 : holeEnd;
};

// Advance past a `{` run in a raw interpolated string, where the `$` count
// decides how many braces open a hole and any shorter run is literal text.
const skipRawBraceRun = (content: string, start: number, holeLength: number): number => {
	const run = runLength(content, start, "{");
	if (run < holeLength) return start + run;
	const holeEnd = consumeInterpolationHole(content, start + run - holeLength, holeLength, true);
	return holeEnd === -1 ? start + run : holeEnd;
};

// A plain C# string. Backslash escapes the next character and a newline ends
// an unterminated literal.
const consumePlainString = (content: string, open: number, interpolated: boolean): LiteralSpan => {
	const len = content.length;
	const bodyStart = open + 1;
	let i = bodyStart;
	while (i < len) {
		const c = content[i];
		if (c === "\\" && i + 1 < len) {
			i += 2;
			continue;
		}
		if (c === '"') return { bodyStart, bodyEnd: i, resumeAt: i + 1 };
		if (c === "\n") return { bodyStart, bodyEnd: i, resumeAt: i };
		if (interpolated && c === "{") {
			i = skipBraceRun(content, i, false);
			continue;
		}
		i++;
	}
	return { bodyStart, bodyEnd: len, resumeAt: len };
};

// A C# verbatim string. A doubled quote is the escape for one quote, a
// backslash is an ordinary character, and the body may span lines.
const consumeVerbatimString = (
	content: string,
	open: number,
	interpolated: boolean,
): LiteralSpan => {
	const len = content.length;
	const bodyStart = open + 1;
	let i = bodyStart;
	while (i < len) {
		const c = content[i];
		if (c === '"') {
			if (content[i + 1] === '"') {
				i += 2;
				continue;
			}
			return { bodyStart, bodyEnd: i, resumeAt: i + 1 };
		}
		if (interpolated && c === "{") {
			i = skipBraceRun(content, i, true);
			continue;
		}
		i++;
	}
	return { bodyStart, bodyEnd: len, resumeAt: len };
};

// A C# raw string literal. An opening run of three or more quotes is closed by
// the next run of at least the same length, and nothing inside is an escape,
// so the body can hold shorter quote runs, backslashes and newlines freely.
const consumeRawString = (content: string, open: number, holeLength: number): LiteralSpan => {
	const len = content.length;
	const openLength = runLength(content, open, '"');
	const bodyStart = open + openLength;
	let i = bodyStart;
	while (i < len) {
		const c = content[i];
		if (c === '"') {
			const run = runLength(content, i, '"');
			if (run >= openLength) return { bodyStart, bodyEnd: i, resumeAt: i + run };
			i += run;
			continue;
		}
		if (holeLength > 0 && c === "{") {
			i = skipRawBraceRun(content, i, holeLength);
			continue;
		}
		i++;
	}
	return { bodyStart, bodyEnd: len, resumeAt: len };
};

interface LiteralPrefix {
	// Index of the opening quote.
	open: number;
	// Number of `$` characters, which is zero for a non-interpolated literal
	// and otherwise the number of braces that open a hole.
	dollars: number;
	// Whether an `@` marks this as a verbatim literal.
	verbatim: boolean;
}

// Read the run of `$` and `@` characters that must be immediately followed by
// a quote. Returns null when no literal starts here, which also covers `@`
// used to escape an identifier such as `@class`.
const readPrefix = (content: string, start: number): LiteralPrefix | null => {
	let i = start;
	let dollars = 0;
	let verbatim = false;
	while (content[i] === "$" || content[i] === "@") {
		if (content[i] === "$") dollars++;
		else verbatim = true;
		i++;
	}
	if (content[i] !== '"') return null;
	return { open: i, dollars, verbatim };
};

// The span of the C# string literal starting at `start`, or null when nothing
// starts there. Covers plain and interpolated strings, verbatim strings in
// either prefix order, and raw string literals with any interpolation depth.
export const csharpStringAt = (content: string, start: number): LiteralSpan | null => {
	const prefix = readPrefix(content, start);
	if (!prefix) return null;
	const { open, dollars, verbatim } = prefix;
	if (verbatim) return consumeVerbatimString(content, open, dollars > 0);
	if (runLength(content, open, '"') >= 3) return consumeRawString(content, open, dollars);
	return consumePlainString(content, open, dollars > 0);
};
