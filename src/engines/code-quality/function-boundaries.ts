const PYTHON_CONTROL_FLOW_RE = /^\s*(?:if|for|while|with|try|except|else|elif|finally|def|class)\b/;

const ARROW_BLOCK_RE = /=>\s*\{/;
const ARROW_END_RE = /=>\s*$/;
const BRACE_START_RE = /^\s*\{/;
const NEW_STATEMENT_RE = /^(?:export\s+)?(?:const|let|var|function|class)\s/;

const isControlFlowBrace = (lineText: string, braceIndex: number): boolean => {
	const before = lineText.substring(0, braceIndex).trimEnd();
	if (before.endsWith(")")) return true;
	if (before.endsWith("=>")) return true;
	if (/\b(?:else|try|finally|do)$/.test(before)) return true;
	return false;
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
	const braceStack: boolean[] = [];

	for (let j = startIndex; j < lines.length; j++) {
		const l = lines[j];

		for (let ci = 0; ci < l.length; ci++) {
			const ch = l[ci];
			if (ch === "{") {
				depth++;
				if (!started) {
					started = true;
					functionStartDepth = depth;
					braceStack.push(false);
				} else {
					const isCF = isControlFlowBrace(l, ci);
					braceStack.push(isCF);
					if (isCF) {
						let cfCount = 0;
						for (const b of braceStack) {
							if (b) cfCount++;
						}
						if (cfCount > maxNesting) maxNesting = cfCount;
					}
				}
			} else if (ch === "}") {
				depth--;
				braceStack.pop();
			}
		}

		if (started && depth < functionStartDepth && j > startIndex) {
			endLine = j;
			break;
		}

		if (j === lines.length - 1) endLine = j;
	}

	if (!started) return { endLine: startIndex, maxNesting: 0 };
	return { endLine, maxNesting };
};

// Walks a multi-line def signature to its matching close paren.
export const extractPythonSignature = (
	lines: string[],
	startIndex: number,
): { params: string; sigEndIndex: number } => {
	let depth = 0;
	let started = false;
	let params = "";

	for (let j = startIndex; j < lines.length; j++) {
		const l = lines[j];
		for (let ci = 0; ci < l.length; ci++) {
			const ch = l[ci];
			if (ch === "(") {
				depth++;
				if (depth === 1 && !started) {
					started = true;
					continue;
				}
			} else if (ch === ")") {
				depth--;
				if (depth === 0) return { params, sigEndIndex: j };
			}
			if (started) params += ch;
		}
		if (started) params += " ";
	}

	return { params, sigEndIndex: startIndex };
};

// Required params only: optional kwargs in an API wrapper are not a smell.
export const countPythonParams = (signature: string): number => {
	let depth = 0;
	const parts: string[] = [];
	let current = "";

	for (const ch of signature) {
		if (ch === "(" || ch === "[" || ch === "{") depth++;
		else if (ch === ")" || ch === "]" || ch === "}") depth--;
		if (ch === "," && depth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	parts.push(current);

	let count = 0;
	for (const raw of parts) {
		const p = raw.trim();
		if (p.length === 0 || p === "*" || p === "/") continue;
		if (p.startsWith("*")) continue;
		if (p.includes("=")) continue;
		const name = p.split(":")[0].trim();
		if (name === "self" || name === "cls") continue;
		count++;
	}
	return count;
};

// Logical body only; docstrings and comments are not length.
export const countPythonBodyCodeLines = (
	lines: string[],
	sigEndIndex: number,
	endLine: number,
): number => {
	let count = 0;
	let inDoc = false;
	let delim = "";

	for (let j = sigEndIndex + 1; j <= endLine && j < lines.length; j++) {
		const t = lines[j].trim();
		if (inDoc) {
			if (t.includes(delim)) inDoc = false;
			continue;
		}
		if (t === "" || t.startsWith("#")) continue;
		const opener = t.startsWith('"""') ? '"""' : t.startsWith("'''") ? "'''" : "";
		if (opener) {
			const rest = t.slice(3);
			if (!rest.includes(opener)) {
				inDoc = true;
				delim = opener;
			}
			continue;
		}
		count++;
	}
	return count;
};

const findPythonFunctionEnd = (
	lines: string[],
	defIndex: number,
	bodyStartIndex: number,
): { endLine: number; maxNesting: number } => {
	const baseIndent = lines[defIndex].match(/^(\s*)/)?.[1].length ?? 0;
	let endLine = bodyStartIndex;
	let maxNesting = 0;
	const controlIndentStack: number[] = [];

	for (let j = bodyStartIndex + 1; j < lines.length; j++) {
		const l = lines[j];
		if (l.trim() === "") {
			endLine = j;
			continue;
		}

		const currentIndent = l.match(/^(\s*)/)?.[1].length ?? 0;
		if (currentIndent <= baseIndent) break;
		endLine = j;

		while (
			controlIndentStack.length > 0 &&
			currentIndent <= controlIndentStack[controlIndentStack.length - 1]
		) {
			controlIndentStack.pop();
		}

		if (PYTHON_CONTROL_FLOW_RE.test(l)) {
			controlIndentStack.push(currentIndent);
			const nesting = controlIndentStack.length;
			if (nesting > maxNesting) maxNesting = nesting;
		}
	}

	return { endLine, maxNesting };
};

export const findFunctionEnd = (
	lines: string[],
	startIndex: number,
	isPython: boolean,
): { endLine: number; maxNesting: number } => {
	if (isPython) {
		const { sigEndIndex } = extractPythonSignature(lines, startIndex);
		return findPythonFunctionEnd(lines, startIndex, sigEndIndex);
	}
	return findBraceFunctionEnd(lines, startIndex);
};

export const isBlockArrow = (lines: string[], startIndex: number): boolean => {
	if (ARROW_BLOCK_RE.test(lines[startIndex])) return true;
	if (ARROW_END_RE.test(lines[startIndex])) {
		const next = lines[startIndex + 1];
		if (next && BRACE_START_RE.test(next)) return true;
	}
	for (let j = startIndex + 1; j < Math.min(startIndex + 3, lines.length); j++) {
		const l = lines[j];
		if (l.trim() === "" || NEW_STATEMENT_RE.test(l.trim())) break;
		if (ARROW_BLOCK_RE.test(l)) return true;
		if (BRACE_START_RE.test(l)) return true;
	}
	return false;
};

export const countTemplateLines = (bodyLines: string[]): number => {
	let insideTemplate = false;
	let templateLineCount = 0;
	for (const line of bodyLines) {
		const startedInside = insideTemplate;
		let escaped = false;
		for (const ch of line) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (ch === "`") insideTemplate = !insideTemplate;
		}
		if (startedInside) templateLineCount++;
	}
	return templateLineCount;
};
