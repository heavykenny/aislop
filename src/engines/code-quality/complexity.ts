import fs from "node:fs";
import path from "node:path";
import { getSourceFiles } from "../../utils/source-files.js";
import type { Diagnostic, EngineContext } from "../types.js";

const countNesting = (line: string): number => {
	const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
	// Rough heuristic: 2 or 4 spaces = 1 level
	return Math.floor(indent / 2);
};

interface FunctionInfo {
	name: string;
	startLine: number;
	lineCount: number;
	maxNesting: number;
	paramCount: number;
}

const FUNCTION_PATTERNS = [
	/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
	/^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?:=>|:\s*\w)/,
	/^\s*def\s+(\w+)\s*\(([^)]*)\)/,
	/^\s*func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(([^)]*)\)/,
	/^\s*fn\s+(\w+)\s*\(([^)]*)\)/,
	/^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)(\w+)\s*\(([^)]*)\)/,
];

const countParams = (paramStr: string): number => {
	if (!paramStr.trim()) return 0;
	return paramStr.split(",").length;
};

const matchFunctionOnLine = (
	line: string,
): { name: string; params: string } | null => {
	for (const pattern of FUNCTION_PATTERNS) {
		const match = line.match(pattern);
		if (match) return { name: match[1], params: match[2] ?? "" };
	}
	return null;
};

const updateDepthForLine = (
	line: string,
	depth: number,
	started: boolean,
): { depth: number; started: boolean } => {
	let d = depth;
	let s = started;
	for (const ch of line) {
		if (ch === "{") {
			d++;
			s = true;
		} else if (ch === ":") {
			s = true;
		} else if (ch === "}") {
			d--;
		}
	}
	return { depth: d, started: s };
};

const findFunctionEnd = (
	lines: string[],
	startIndex: number,
): { endLine: number; maxNesting: number } => {
	let depth = 0;
	let started = false;
	let endLine = startIndex;
	let maxNesting = 0;

	for (let j = startIndex; j < lines.length; j++) {
		const l = lines[j];
		({ depth, started } = updateDepthForLine(l, depth, started));

		if (started) {
			const nesting = countNesting(l);
			if (nesting > maxNesting) maxNesting = nesting;
		}

		if (started && depth <= 0 && j > startIndex) {
			endLine = j;
			break;
		}

		if (j === lines.length - 1) endLine = j;
	}

	return { endLine, maxNesting };
};

const analyzeFunctions = (content: string): FunctionInfo[] => {
	const lines = content.split("\n");
	const functions: FunctionInfo[] = [];

	for (let i = 0; i < lines.length; i++) {
		const fnMatch = matchFunctionOnLine(lines[i]);
		if (!fnMatch) continue;

		const { endLine, maxNesting } = findFunctionEnd(lines, i);

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

	if (lineCount > limits.maxFileLoc) {
		results.push({
			filePath: relativePath,
			engine: "code-quality",
			rule: "complexity/file-too-large",
			severity: "warning",
			message: `File has ${lineCount} lines (max: ${limits.maxFileLoc})`,
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
	const diagnostics = checkFileDiagnostics(relativePath, content, limits);

	for (const fn of analyzeFunctions(content)) {
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
