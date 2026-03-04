import fs from "node:fs";
import path from "node:path";
import { getSourceFiles } from "../../utils/source-files.js";
import type { Diagnostic, EngineContext } from "../types.js";

interface FunctionInfo {
	name: string;
	startLine: number;
	lineCount: number;
	maxNesting: number;
	paramCount: number;
}

interface FunctionPattern {
	regex: RegExp;
	langFilter: string[];
}

const FUNCTION_PATTERNS: FunctionPattern[] = [
	{
		regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
		langFilter: [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"],
	},
	{
		regex:
			/^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?:=>|:\s*\w)/,
		langFilter: [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"],
	},
	{
		regex: /^\s*def\s+(\w+)\s*\(([^)]*)\)/,
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
		regex:
			/^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)(\w+)\s*\(([^)]*)\)/,
		langFilter: [".java", ".cs", ".cpp", ".c", ".php"],
	},
];

const countParams = (paramStr: string): number => {
	if (!paramStr.trim()) return 0;
	return paramStr.split(",").length;
};

const matchFunctionOnLine = (
	line: string,
	ext: string,
): { name: string; params: string; patternIndex: number } | null => {
	for (let i = 0; i < FUNCTION_PATTERNS.length; i++) {
		const pattern = FUNCTION_PATTERNS[i];
		if (!pattern.langFilter.includes(ext)) continue;
		const match = line.match(pattern.regex);
		if (match)
			return { name: match[1], params: match[2] ?? "", patternIndex: i };
	}
	return null;
};

const PYTHON_CONTROL_FLOW_RE =
	/^\s*(?:if|for|while|with|try|except|else|elif|finally|def|class)\b/;

const findFunctionEnd = (
	lines: string[],
	startIndex: number,
	isPython: boolean,
): { endLine: number; maxNesting: number } => {
	if (isPython) {
		return findPythonFunctionEnd(lines, startIndex);
	}
	return findBraceFunctionEnd(lines, startIndex);
};

const findBraceFunctionEnd = (
	lines: string[],
	startIndex: number,
): { endLine: number; maxNesting: number } => {
	let depth = 0;
	let started = false;
	let endLine = startIndex;
	let maxNesting = 0;
	let functionStartDepth = 0;

	for (let j = startIndex; j < lines.length; j++) {
		const l = lines[j];
		// Track brace depth char by char, recording nesting relative to function start
		for (const ch of l) {
			if (ch === "{") {
				depth++;
				if (!started) {
					started = true;
					functionStartDepth = depth;
				} else {
					const relative = depth - functionStartDepth;
					if (relative > maxNesting) maxNesting = relative;
				}
			} else if (ch === "}") {
				depth--;
			}
		}

		if (started && depth < functionStartDepth && j > startIndex) {
			endLine = j;
			break;
		}

		if (j === lines.length - 1) endLine = j;
	}

	return { endLine, maxNesting };
};

const findPythonFunctionEnd = (
	lines: string[],
	startIndex: number,
): { endLine: number; maxNesting: number } => {
	const startLine = lines[startIndex];
	const baseIndent = startLine.match(/^(\s*)/)?.[1].length ?? 0;
	let endLine = startIndex;
	let maxNesting = 0;
	// Track control-flow nesting depth via a stack of indent levels
	const controlIndentStack: number[] = [];

	for (let j = startIndex + 1; j < lines.length; j++) {
		const l = lines[j];
		// Skip blank lines
		if (l.trim() === "") {
			endLine = j;
			continue;
		}

		const currentIndent = l.match(/^(\s*)/)?.[1].length ?? 0;

		// If we've returned to or past the base indent, function ended
		if (currentIndent <= baseIndent) {
			break;
		}

		endLine = j;

		// Pop any control-flow levels that we've exited
		while (
			controlIndentStack.length > 0 &&
			currentIndent <= controlIndentStack[controlIndentStack.length - 1]
		) {
			controlIndentStack.pop();
		}

		// If this line starts with a control-flow keyword, push its indent
		if (PYTHON_CONTROL_FLOW_RE.test(l)) {
			controlIndentStack.push(currentIndent);
			const nesting = controlIndentStack.length;
			if (nesting > maxNesting) maxNesting = nesting;
		}
	}

	return { endLine, maxNesting };
};

const isDataFile = (content: string): boolean => {
	const lines = content.split("\n");
	const nonEmpty = lines.filter((l) => l.trim().length > 0);
	if (nonEmpty.length === 0) return false;
	const dataLinePattern = /^\s*[{}[\]"']/;
	const dataLines = nonEmpty.filter((l) => dataLinePattern.test(l));
	return dataLines.length / nonEmpty.length > 0.8;
};

const analyzeFunctions = (content: string, ext: string): FunctionInfo[] => {
	const lines = content.split("\n");
	const functions: FunctionInfo[] = [];

	for (let i = 0; i < lines.length; i++) {
		const fnMatch = matchFunctionOnLine(lines[i], ext);
		if (!fnMatch) continue;

		const isPython = fnMatch.patternIndex === 2;
		const { endLine, maxNesting } = findFunctionEnd(lines, i, isPython);

		functions.push({
			name: fnMatch.name,
			startLine: i + 1,
			lineCount: endLine - i + 1,
			maxNesting,
			paramCount: countParams(fnMatch.params),
		});
	}

	return functions;
};

interface QualityLimits {
	maxFunctionLoc: number;
	maxFileLoc: number;
	maxNesting: number;
	maxParams: number;
}

const checkFileDiagnostics = (
	relativePath: string,
	content: string,
	limits: QualityLimits,
): Diagnostic[] => {
	const results: Diagnostic[] = [];
	const lineCount = content.split("\n").length;
	const ext = path.extname(relativePath).toLowerCase();

	// Skip data files entirely
	if (isDataFile(content)) return results;

	// Apply 2x threshold for JSX/TSX files
	const isJsx = ext === ".jsx" || ext === ".tsx";
	const effectiveMax = isJsx ? limits.maxFileLoc * 2 : limits.maxFileLoc;

	if (lineCount > effectiveMax) {
		results.push({
			filePath: relativePath,
			engine: "code-quality",
			rule: "complexity/file-too-large",
			severity: "warning",
			message: `File has ${lineCount} lines (max: ${effectiveMax})`,
			help: "Consider splitting this file into smaller modules",
			line: 0,
			column: 0,
			category: "Complexity",
			fixable: false,
		});
	}

	return results;
};

const checkFunctionDiagnostics = (
	relativePath: string,
	fn: FunctionInfo,
	limits: QualityLimits,
): Diagnostic[] => {
	const results: Diagnostic[] = [];

	if (fn.lineCount > limits.maxFunctionLoc) {
		results.push({
			filePath: relativePath,
			engine: "code-quality",
			rule: "complexity/function-too-long",
			severity: "warning",
			message: `Function '${fn.name}' has ${fn.lineCount} lines (max: ${limits.maxFunctionLoc})`,
			help: "Consider breaking this function into smaller pieces",
			line: fn.startLine,
			column: 0,
			category: "Complexity",
			fixable: false,
		});
	}

	if (fn.maxNesting > limits.maxNesting) {
		results.push({
			filePath: relativePath,
			engine: "code-quality",
			rule: "complexity/deep-nesting",
			severity: "warning",
			message: `Function '${fn.name}' has nesting depth ${fn.maxNesting} (max: ${limits.maxNesting})`,
			help: "Consider using early returns or extracting nested logic",
			line: fn.startLine,
			column: 0,
			category: "Complexity",
			fixable: false,
		});
	}

	if (fn.paramCount > limits.maxParams) {
		results.push({
			filePath: relativePath,
			engine: "code-quality",
			rule: "complexity/too-many-params",
			severity: "warning",
			message: `Function '${fn.name}' has ${fn.paramCount} parameters (max: ${limits.maxParams})`,
			help: "Consider using an options object parameter",
			line: fn.startLine,
			column: 0,
			category: "Complexity",
			fixable: false,
		});
	}

	return results;
};

const checkFileComplexity = (
	filePath: string,
	rootDirectory: string,
	limits: QualityLimits,
): Diagnostic[] => {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch {
		return [];
	}

	const relativePath = path.relative(rootDirectory, filePath);
	const ext = path.extname(filePath).toLowerCase();
	const diagnostics = checkFileDiagnostics(relativePath, content, limits);

	for (const fn of analyzeFunctions(content, ext)) {
		diagnostics.push(...checkFunctionDiagnostics(relativePath, fn, limits));
	}

	return diagnostics;
};

export const checkComplexity = async (
	context: EngineContext,
): Promise<Diagnostic[]> => {
	const files = getSourceFiles(context);
	const limits: QualityLimits = context.config.quality;
	const diagnostics: Diagnostic[] = [];

	for (const filePath of files) {
		diagnostics.push(
			...checkFileComplexity(filePath, context.rootDirectory, limits),
		);
	}

	return diagnostics;
};
