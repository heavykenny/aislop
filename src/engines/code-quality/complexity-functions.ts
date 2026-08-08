import { maskStringsAndComments } from "../../utils/source-masker.js";
import { CPP_SOURCE_EXTENSIONS } from "../cpp-targets.js";
import { CPP_FUNCTION_PATTERNS, type FunctionPattern } from "./complexity-cpp.js";
import {
	CSHARP_FUNCTION_PATTERNS,
	logicalSignatureLine,
	MULTILINE_SIGNATURE_EXTS,
} from "./complexity-csharp.js";
import {
	countPythonBodyCodeLines,
	countPythonParams,
	countTemplateLines,
	extractPythonSignature,
	findFunctionEnd,
	isBlockArrow,
} from "./function-boundaries.js";

export interface FunctionInfo {
	name: string;
	startLine: number;
	lineCount: number;
	maxNesting: number;
	paramCount: number;
	templateLines: number;
}

const FUNCTION_PATTERNS: FunctionPattern[] = [
	{
		regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
		langFilter: [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"],
	},
	{
		regex: /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?:=>|:\s*\w)/,
		langFilter: [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"],
	},
	{
		regex: /^\s*(?:async\s+)?def\s+(\w+)\s*\(/,
		langFilter: [".py"],
	},
	{
		regex: /^\s*func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(([^)]*)\)/,
		langFilter: [".go"],
	},
	{
		regex: /^\s*fn\s+(\w+)\s*\(([^)]*)\)/,
		langFilter: [".rs"],
	},
	{
		// The (?:(?!STMT_KW)\w+\s+) part requires that the "return type" token is not a
		// statement keyword. This prevents a call expression like `return Foo(args)` or
		// `if (Foo(args))` from matching as a definition: `return` / `if` / etc. would
		// be parsed as the return type, but the negative lookahead inside the token group
		// rejects them before \w+ can consume the keyword.
		regex:
			/^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:(?!(?:return|if|for|while|switch|do|else|throw|delete|new|break|continue|goto|try|catch)\b)\w+\s+)(\w+)\s*\(([^)]*)\)/,
		// C# (.cs), the full C++ source set (.c/.cc/.cpp/.cxx and the
		// .h/.hh/.hpp/.hxx headers where inline and class-member bodies live),
		// plus Java and PHP. Header coverage relies on findBraceFunctionEnd's
		// declaration guard to skip prototypes (`void foo(int x);`) with no body.
		langFilter: [".java", ".php", ".cs", ...CPP_SOURCE_EXTENSIONS],
	},
	...CSHARP_FUNCTION_PATTERNS,
	...CPP_FUNCTION_PATTERNS,
];

// Count top-level parameters, ignoring commas nested inside generic type
// arguments (`IReadOnlyDictionary<string, int>`), tuples (`(int, int)`), arrays,
// or default initializers. A plain `.split(",")` overcounts C# signatures
// whose parameter types carry commas - a 5-parameter constructor of
// dictionary-typed arguments would be misreported as 9. Bracket depth floors at
// zero so an unmatched closer (a stray relational `>` in a default expression)
// cannot drive the depth negative and leak inner commas back to the top level.
const countParams = (parameterList: string): number => {
	const trimmed = parameterList.trim();
	if (!trimmed) return 0;
	let depth = 0;
	let count = 1;
	for (const ch of trimmed) {
		if (ch === "(" || ch === "[" || ch === "{" || ch === "<") {
			depth++;
		} else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") {
			depth = Math.max(0, depth - 1);
		} else if (ch === "," && depth === 0) {
			count++;
		}
	}
	return count;
};

const matchFunctionOnLine = (
	line: string,
	ext: string,
): { name: string; params: string; patternIndex: number } | null => {
	for (let i = 0; i < FUNCTION_PATTERNS.length; i++) {
		const pattern = FUNCTION_PATTERNS[i];
		if (!pattern.langFilter.includes(ext)) continue;
		const match = line.match(pattern.regex);
		if (match) return { name: match[1], params: match[2] ?? "", patternIndex: i };
	}
	return null;
};

export const isDataFile = (content: string): boolean => {
	const lines = content.split("\n");
	const nonEmpty = lines.filter((l) => l.trim().length > 0);
	if (nonEmpty.length === 0) return false;
	const dataLinePattern = /^\s*[{}[\]"']/;
	const dataLines = nonEmpty.filter((l) => dataLinePattern.test(l));
	return dataLines.length / nonEmpty.length > 0.8;
};

const TEST_PATH_RE = /(?:^|\/)(?:tests?|spec|specs|__tests__|__spec__|src\/test)\//i;
const TEST_BASENAME_RE =
	/(?:^|[/.])(?:test_[\w-]+\.(?:py|rb)|[\w-]+_(?:test|spec)\.(?:py|rb|go|rs)|[\w-]+\.(?:test|spec)\.(?:[jt]sx?|mjs|cjs)|conftest\.py|[A-Z]\w*Tests?\.(?:java|cs|php))$/;

const MIGRATION_PATH_RE = /(?:^|\/)(?:migrations?|migrate|prisma\/migrations|db\/migrate)\//i;

const FIXTURE_PATH_RE =
	/(?:^|\/)(?:__fixtures__|__snapshots__|__mocks__|fixtures?|snapshots?|seeds?|stubs?)\//i;

const GENERATED_PATH_RE =
	/(?:^|\/)(?:generated|gen|build|dist|out|target|coverage|node_modules|vendor|\.next|\.nuxt|\.svelte-kit)\//i;

export const isExemptFromComplexity = (relativePath: string): boolean =>
	TEST_PATH_RE.test(relativePath) ||
	TEST_BASENAME_RE.test(relativePath) ||
	MIGRATION_PATH_RE.test(relativePath) ||
	FIXTURE_PATH_RE.test(relativePath) ||
	GENERATED_PATH_RE.test(relativePath);

export const analyzeFunctions = (content: string, ext: string): FunctionInfo[] => {
	const lines = content.split("\n");
	// String and comment bodies blanked (newlines preserved, so line indices still
	// align with `lines`) so the brace matcher never counts a `{`/`}` inside a
	// literal or comment as a block delimiter.
	const maskedLines = maskStringsAndComments(content, ext).split("\n");
	const functions: FunctionInfo[] = [];

	for (let i = 0; i < lines.length; i++) {
		// For C#/C++ match against the masked (string/comment-blanked) source so a
		// wrapped signature is joined on balanced parens and literals never skew it.
		const matchLine = MULTILINE_SIGNATURE_EXTS.has(ext)
			? logicalSignatureLine(maskedLines, i)
			: lines[i];
		const fnMatch = matchFunctionOnLine(matchLine, ext);
		if (!fnMatch) continue;

		const isPython = fnMatch.patternIndex === 2;

		if (fnMatch.patternIndex === 1 && !isBlockArrow(maskedLines, i)) {
			continue;
		}

		const { endLine, maxNesting } = findFunctionEnd(maskedLines, i, isPython);
		// endLine < 0 marks a non-definition (prototype, static-call statement) that
		// matched a pattern by shape but has no body - skip it entirely.
		if (endLine < 0) continue;
		let templateLines: number;
		let paramCount: number;
		if (isPython) {
			const sig = extractPythonSignature(lines, i);
			const codeLines = countPythonBodyCodeLines(lines, sig.sigEndIndex, endLine);
			templateLines = endLine - i + 1 - codeLines;
			paramCount = countPythonParams(sig.params);
		} else {
			templateLines = countTemplateLines(lines.slice(i + 1, endLine));
			paramCount = countParams(fnMatch.params);
		}

		functions.push({
			name: fnMatch.name,
			startLine: i + 1,
			lineCount: endLine - i + 1,
			maxNesting,
			paramCount,
			templateLines,
		});
	}

	return functions;
};
