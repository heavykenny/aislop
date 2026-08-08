import { CPP_SOURCE_EXTENSIONS } from "../cpp-targets.js";
import type { FunctionPattern } from "./complexity-cpp.js";

// C#-only function-boundary pattern, kept out of complexity.ts so that file
// stays inside its own file-too-large budget.
export const CSHARP_FUNCTION_PATTERNS: FunctionPattern[] = [
	{
		// C# methods and constructors the single-token pattern in complexity.ts
		// misses: any run of access/async/etc. modifiers, then an arbitrary
		// return type (which may be generic/array/qualified/nullable, or absent
		// for a constructor), then the member name. A modifier is required so
		// bare `Type name(...)` calls/declarations are not matched. `[^()=;{]`
		// stops the lazy return-type run before a body brace, an
		// expression-body `=>`, or a field initializer.
		regex:
			/^\s*(?:\[[^\]]*\]\s*)*(?:(?:public|private|protected|internal|static|async|virtual|override|sealed|abstract|extern|unsafe|new|partial|readonly)\s+)+[^()=;{]*?(\w+)\s*\(([^)]*)\)/,
		langFilter: [".cs"],
	},
];

// C# has a language-native remediation: partial classes split a type across
// files with no API or linkage cost, so point C# users at it directly.
export const CSHARP_FILE_TOO_LARGE_HELP =
	"Consider splitting this file into partial class files or smaller modules";

// Extensions whose function signatures may wrap across multiple physical lines
// and so need logical-signature joining before the patterns are applied. Scoped
// to C#/C++ so Java/PHP detection stays byte-identical to the single-line path.
export const MULTILINE_SIGNATURE_EXTS = new Set([".cs", ...CPP_SOURCE_EXTENSIONS]);

// A brace-language signature can span lines (wrapped parameter lists). When the
// line at `startIndex` opens more parens than it closes, join following lines
// (up to a small cap, stopping at a statement `;`) so the single-line
// FUNCTION_PATTERNS can see the whole `name(...)` on one logical line. Newlines
// become spaces; the reported start line stays `startIndex`.
export const logicalSignatureLine = (lines: string[], startIndex: number): string => {
	const first = lines[startIndex];
	let depth = 0;
	let sawOpen = false;
	for (const ch of first) {
		if (ch === "(") {
			depth++;
			sawOpen = true;
		} else if (ch === ")") depth--;
	}
	if (!sawOpen || depth <= 0) return first;

	let joined = first;
	for (let j = startIndex + 1; j < lines.length && j < startIndex + 12; j++) {
		const line = lines[j];
		joined += ` ${line}`;
		for (const ch of line) {
			if (ch === "(") depth++;
			else if (ch === ")") depth--;
		}
		if (depth <= 0) break;
		if (line.includes(";")) break;
	}
	return joined;
};
