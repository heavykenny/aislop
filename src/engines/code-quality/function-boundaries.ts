const PYTHON_CONTROL_FLOW_RE = /^\s*(?:if|for|while|with|try|except|else|elif|finally|def|class)\b/;

const ARROW_BLOCK_RE = new RegExp("=>\\s*\\{");
const ARROW_END_RE = new RegExp("=>\\s*$");
const BRACE_START_RE = new RegExp("^\\s*\\{");
const NEW_STATEMENT_RE = new RegExp("^(?:export\\s+)?(?:const|let|var|function|class)\\s");

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

const findPythonFunctionEnd = (
	lines: string[],
	startIndex: number,
): { endLine: number; maxNesting: number } => {
	const startLine = lines[startIndex];
	const baseIndent = startLine.match(/^(\s*)/)?.[1].length ?? 0;
	let endLine = startIndex;
	let maxNesting = 0;
	const controlIndentStack: number[] = [];

	for (let j = startIndex + 1; j < lines.length; j++) {
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
	if (isPython) return findPythonFunctionEnd(lines, startIndex);
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
		let escape = false;
		for (const ch of line) {
			if (escape) {
				escape = false;
				continue;
			}
			if (ch === "\\") {
				escape = true;
				continue;
			}
			if (ch === "`") insideTemplate = !insideTemplate;
		}
		if (startedInside) templateLineCount++;
	}
	return templateLineCount;
};
