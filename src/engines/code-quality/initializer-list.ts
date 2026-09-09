// C++ member-initializer lists sit between a constructor's parameter list and
// its body. Their brace initializers (`value_{0}`) open and close before the
// body does, so a scanner that takes the first depth-1 brace as the body ends
// the constructor on the initializer line. This module locates the brace that
// actually opens the body. Kept out of function-boundaries.ts so that file stays
// inside its own file-too-large budget.

interface SourcePosition {
	lineIndex: number;
	columnIndex: number;
}

// How far past the signature an initializer list is allowed to run. One member
// per line is idiomatic, so a class with many members needs plenty of headroom;
// past the bound the caller falls back to the plain first-brace scan and simply
// under-reports the constructor. The scan stops at the first character that is
// not initializer syntax, so this ceiling is only ever reached by text that
// really does parse as one, and it caps a runaway scan over malformed input.
const MAXIMUM_INITIALIZER_LINES = 200;

// Trailing qualifiers a constructor signature may carry before its `:`.
const SIGNATURE_QUALIFIERS = new Set(["const", "volatile", "noexcept", "override", "final"]);

const NAME_CHARACTER_RE = /[A-Za-z0-9_:~.*&[\]]/;

// End-of-line reads as whitespace; past the last line reads as null.
const characterAt = (lines: string[], position: SourcePosition): string | null => {
	const line = lines[position.lineIndex];
	if (line === undefined) return null;
	if (position.columnIndex >= line.length) return "\n";
	return line[position.columnIndex];
};

const advance = (lines: string[], position: SourcePosition): SourcePosition => {
	const line = lines[position.lineIndex];
	if (line === undefined || position.columnIndex >= line.length) {
		return { lineIndex: position.lineIndex + 1, columnIndex: 0 };
	}
	return { lineIndex: position.lineIndex, columnIndex: position.columnIndex + 1 };
};

const isSamePosition = (left: SourcePosition, right: SourcePosition): boolean =>
	left.lineIndex === right.lineIndex && left.columnIndex === right.columnIndex;

const skipWhitespace = (lines: string[], position: SourcePosition): SourcePosition => {
	let current = position;
	while (true) {
		const character = characterAt(lines, current);
		if (character === null || !/\s/.test(character)) return current;
		current = advance(lines, current);
	}
};

// `position` must sit on `open`; returns the position just past its match.
const skipBalanced = (
	lines: string[],
	position: SourcePosition,
	open: string,
	close: string,
	limitLine: number,
): SourcePosition | null => {
	let current = position;
	let depth = 0;
	while (current.lineIndex <= limitLine) {
		const character = characterAt(lines, current);
		if (character === null) return null;
		if (character === open) depth++;
		else if (character === close) {
			depth--;
			if (depth === 0) return advance(lines, current);
		}
		current = advance(lines, current);
	}
	return null;
};

// Consume one initializer target (`value_`, `Base<int, float>`, `Base::Inner`),
// stopping at the `(` or `{` that follows it. Commas and spaces inside template
// arguments belong to the name; at angle depth zero a comma separates
// initializers and a space ends the name.
const skipInitializerName = (lines: string[], position: SourcePosition): SourcePosition => {
	let current = position;
	let angleDepth = 0;
	while (true) {
		const character = characterAt(lines, current);
		if (character === null) return current;
		if (character === "<") angleDepth++;
		else if (character === ">") angleDepth = Math.max(0, angleDepth - 1);
		else if (character === "," || /\s/.test(character)) {
			if (angleDepth === 0) return current;
		} else if (!NAME_CHARACTER_RE.test(character)) return current;
		current = advance(lines, current);
	}
};

// A function-try-block puts `try` between the last initializer and the body:
// `Foo::Foo() : value_{0} try { ... } catch (...) { ... }`. Without this the
// initializer list parses but the body brace is never reached, and the fallback
// scan ends the constructor on the initializer line. Returns `position`
// unchanged when the next word is anything else.
const skipFunctionTryKeyword = (lines: string[], position: SourcePosition): SourcePosition => {
	const wordEnd = skipInitializerName(lines, position);
	const word = lines[position.lineIndex]?.slice(position.columnIndex, wordEnd.columnIndex) ?? "";
	if (word !== "try") return position;
	return skipWhitespace(lines, wordEnd);
};

// Walk the parameter list and any trailing qualifiers, returning the position of
// the `:` that opens a member-initializer list, or null if there is none.
const findInitializerListColon = (
	lines: string[],
	startIndex: number,
	limitLine: number,
): SourcePosition | null => {
	let current: SourcePosition = { lineIndex: startIndex, columnIndex: 0 };
	while (current.lineIndex <= limitLine) {
		const character = characterAt(lines, current);
		if (character === null || character === "{" || character === ";") return null;
		if (character === "(") break;
		current = advance(lines, current);
	}
	const afterParameters = skipBalanced(lines, current, "(", ")", limitLine);
	if (!afterParameters) return null;

	current = afterParameters;
	while (current.lineIndex <= limitLine) {
		current = skipWhitespace(lines, current);
		const character = characterAt(lines, current);
		if (character === null) return null;
		if (character === ":") {
			// `::` is a qualified name, not an initializer list.
			return characterAt(lines, advance(lines, current)) === ":" ? null : current;
		}
		// A reference qualifier (`void f() & {`).
		if (character === "&") {
			current = advance(lines, current);
			continue;
		}
		// A `noexcept(...)` or `throw(...)` specification.
		if (character === "(") {
			const afterSpecification = skipBalanced(lines, current, "(", ")", limitLine);
			if (!afterSpecification) return null;
			current = afterSpecification;
			continue;
		}
		const wordStart = current;
		current = skipInitializerName(lines, current);
		if (isSamePosition(current, wordStart)) return null;
		const word =
			lines[wordStart.lineIndex]?.slice(wordStart.columnIndex, current.columnIndex) ?? "";
		if (!SIGNATURE_QUALIFIERS.has(word.trim())) return null;
	}
	return null;
};

// Locate the `{` that opens the body of a definition whose signature is followed
// by a C++ member-initializer list. Returns null unless everything between the
// parameter list and the body parses as a complete initializer list (comma
// separated `name(...)` or `name{...}` elements), so a construct that merely
// puts a `:` after the parameter list - a TypeScript or PHP return-type
// annotation, a C# `: base(...)` chain - is either unaffected or falls back to
// the plain first-brace scan.
export const findInitializerListBodyStart = (
	lines: string[],
	startIndex: number,
): SourcePosition | null => {
	const limitLine = Math.min(lines.length - 1, startIndex + MAXIMUM_INITIALIZER_LINES);
	const colon = findInitializerListColon(lines, startIndex, limitLine);
	if (!colon) return null;

	let current = advance(lines, colon);
	while (current.lineIndex <= limitLine) {
		current = skipWhitespace(lines, current);
		const nameEnd = skipInitializerName(lines, current);
		if (isSamePosition(nameEnd, current)) return null;

		// The opener must abut the name: `value_{0}`, never `value_ {0}`. Allowing
		// a space there would make a return-type annotation (`: Promise<void> {`)
		// parse as an initializer and swallow the body.
		const opener = characterAt(lines, nameEnd);
		if (opener !== "(" && opener !== "{") return null;
		const closer = opener === "(" ? ")" : "}";
		const afterInitializer = skipBalanced(lines, nameEnd, opener, closer, limitLine);
		if (!afterInitializer) return null;

		current = skipWhitespace(lines, afterInitializer);
		// A pack expansion (`Bases(arguments)...`) trails the initializer.
		while (characterAt(lines, current) === ".") current = advance(lines, current);
		current = skipWhitespace(lines, current);
		current = skipFunctionTryKeyword(lines, current);

		const next = characterAt(lines, current);
		if (next === "{") return current;
		if (next !== ",") return null;
		current = advance(lines, current);
	}
	return null;
};
