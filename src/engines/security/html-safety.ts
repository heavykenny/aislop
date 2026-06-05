const SAFE_EMPTY_INNER_HTML_RE = /^\.innerHTML\s*=\s*(?:""|''|``)\s*;?/;
const SAFE_SANITIZED_INNER_HTML_RE =
	/^\.innerHTML\s*=\s*(?:escapeHtml|sanitizeHtml|sanitizeHTML|DOMPurify\.sanitize)\s*\([^;\n]*\)\s*;?(?:\n|$)/;
const SANITIZER_EXPR_RE =
	/^(?:escapeHtml|escapeHTML|sanitizeHtml|sanitizeHTML|DOMPurify\.sanitize)\s*\([^;\n]*\)$/;
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const STATIC_STRING_RE = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\$])*`)$/;
const NUMERICISH_EXPR_RE =
	/^(?:[-+]?\d+(?:\.\d+)?|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\s*\|\|\s*[-+]?\d+(?:\.\d+)?)?)$/;
const NUMERICISH_NAME_RE =
	/(?:^|\.)(?:count|length|size|width|height|top|right|bottom|left|duration|elapsed|timestamp|time|ms|port|pid|attempt|attempts|index|total|x|y)$|(?:count|length|size|width|height|duration|elapsed|timestamp|time|port|pid|attempt|index|total)$/i;
const SAFE_FORMAT_CALL_RE = /^(?:format[A-Z]\w*|fmt[A-Z]?\w*)\s*\((.*)\)$/;

const consumeQuotedLiteral = (
	content: string,
	startIndex: number,
	quote: "'" | '"',
): { endIndex: number } | null => {
	let i = startIndex + 1;
	while (i < content.length) {
		const char = content[i];
		if (char === "\\") {
			i += 2;
			continue;
		}
		if (char === quote) return { endIndex: i };
		if (char === "\n") return null;
		i++;
	}
	return null;
};

export const consumeTemplateLiteral = (
	content: string,
	startIndex: number,
): { body: string; endIndex: number } | null => {
	const openIndex = content.indexOf("`", startIndex);
	if (openIndex === -1) return null;
	let i = openIndex + 1;
	while (i < content.length) {
		const char = content[i];
		if (char === "\\") {
			i += 2;
			continue;
		}
		if (char === "`") {
			return { body: content.slice(openIndex + 1, i), endIndex: i };
		}
		i++;
	}
	return null;
};

const assignmentTailIsClosed = (content: string, endIndex: number): boolean =>
	/^\s*(?:;[^\n]*)?(?:\n|$)/.test(content.slice(endIndex + 1));

const assignmentRhsStart = (content: string, matchIndex: number): number | null => {
	const match = /^\.innerHTML\s*=\s*/.exec(content.slice(matchIndex));
	return match ? matchIndex + match[0].length : null;
};

const templateExpressions = (templateBody: string): string[] =>
	[...templateBody.matchAll(/\$\{\s*([^}]+?)\s*\}/g)].map((match) => match[1].trim());

const staticTernaryRe =
	/^\s*[^?]+\?\s*(?:"[^"]*"|'[^']*'|`[^`$]*`)\s*:\s*(?:"[^"]*"|'[^']*'|`[^`$]*`)\s*$/;

const splitTopLevelTernary = (expr: string): { whenTrue: string; whenFalse: string } | null => {
	let quote: "'" | '"' | "`" | null = null;
	let depth = 0;
	let question = -1;
	let colon = -1;
	for (let i = 0; i < expr.length; i++) {
		const char = expr[i];
		if (char === "\\") {
			i++;
			continue;
		}
		if ((char === "'" || char === '"' || char === "`") && quote === null) {
			quote = char;
			continue;
		}
		if (char === quote) {
			quote = null;
			continue;
		}
		if (quote) continue;
		if (char === "(" || char === "[" || char === "{") depth++;
		else if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1);
		else if (char === "?" && depth === 0 && question === -1) question = i;
		else if (char === ":" && depth === 0 && question !== -1) {
			colon = i;
			break;
		}
	}
	if (question === -1 || colon === -1) return null;
	return {
		whenTrue: expr.slice(question + 1, colon).trim(),
		whenFalse: expr.slice(colon + 1).trim(),
	};
};

const isNumericishExpression = (expr: string): boolean => {
	const normalized = expr.trim();
	if (/^(?:Math\.\w+|Number|parseInt|parseFloat)\s*\(/.test(normalized)) return true;
	if (!NUMERICISH_EXPR_RE.test(normalized)) return false;
	return /\d/.test(normalized) || NUMERICISH_NAME_RE.test(normalized);
};

const isSafeTemplateLiteralExpression = (expr: string, safeNames: Set<string>): boolean => {
	if (!expr.startsWith("`") || !expr.endsWith("`")) return false;
	const body = expr.slice(1, -1);
	const expressions = templateExpressions(body);
	return expressions.every((part) => isSafeHtmlExpression(part, safeNames));
};

const collectSafeHtmlNames = (content: string, matchIndex: number): Set<string> => {
	const safeNames = new Set<string>();
	const prefix = content.slice(Math.max(0, matchIndex - 8000), matchIndex);
	for (const rawLine of prefix.split("\n")) {
		const line = rawLine.trim();
		let match = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)\s*;?$/.exec(line);
		if (match) {
			const [, name, expr] = match;
			if (isSafeHtmlExpression(expr.trim(), safeNames)) safeNames.add(name);
			else safeNames.delete(name);
			continue;
		}

		match = /^([A-Za-z_$][\w$]*)\s*\+=\s*(.+?)\s*;?$/.exec(line);
		if (match) {
			const [, name, expr] = match;
			if (safeNames.has(name) && isSafeHtmlExpression(expr.trim(), safeNames)) {
				safeNames.add(name);
			} else {
				safeNames.delete(name);
			}
			continue;
		}

		match = /^([A-Za-z_$][\w$]*)\s*=\s*(.+?)\s*;?$/.exec(line);
		if (match) {
			const [, name, expr] = match;
			if (isSafeHtmlExpression(expr.trim(), safeNames)) safeNames.add(name);
			else safeNames.delete(name);
		}
	}
	return safeNames;
};

const isSafeHtmlExpression = (expr: string, safeNames: Set<string>): boolean => {
	const normalized = expr.trim();
	if (SANITIZER_EXPR_RE.test(normalized)) return true;
	if (STATIC_STRING_RE.test(normalized)) return true;
	if (staticTernaryRe.test(expr)) return true;
	if (isNumericishExpression(normalized)) return true;
	if (IDENT_RE.test(normalized) && safeNames.has(normalized)) return true;
	if (isSafeTemplateLiteralExpression(normalized, safeNames)) return true;
	const ternary = splitTopLevelTernary(normalized);
	if (
		ternary &&
		isSafeHtmlExpression(ternary.whenTrue, safeNames) &&
		isSafeHtmlExpression(ternary.whenFalse, safeNames)
	) {
		return true;
	}
	const formatCall = SAFE_FORMAT_CALL_RE.exec(normalized);
	if (formatCall) {
		const args = formatCall[1]
			.split(",")
			.map((arg) => arg.trim())
			.filter((arg) => arg.length > 0);
		return args.every(
			(arg) => isNumericishExpression(arg) || (IDENT_RE.test(arg) && safeNames.has(arg)),
		);
	}
	return false;
};

const readSingleLineRhs = (content: string, rhsStart: number): string => {
	const lineEnd = content.indexOf("\n", rhsStart);
	const line = content.slice(rhsStart, lineEnd === -1 ? content.length : lineEnd);
	let quote: "'" | '"' | "`" | null = null;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === "\\") {
			i++;
			continue;
		}
		if ((char === "'" || char === '"' || char === "`") && quote === null) {
			quote = char;
			continue;
		}
		if (char === quote) {
			quote = null;
			continue;
		}
		if (char === ";" && quote === null) return line.slice(0, i).trim();
	}
	return line.trim();
};

const isSafeMapJoinHtmlAssignment = (content: string, rhsStart: number): boolean => {
	const head = content.slice(rhsStart);
	const mapMatch = /^[A-Za-z_$][\w$.]*\.map\(\s*[A-Za-z_$][\w$]*\s*=>\s*`/.exec(head);
	if (!mapMatch) return false;
	const templateStart = rhsStart + mapMatch[0].length - 1;
	const template = consumeTemplateLiteral(content, templateStart);
	if (!template) return false;
	if (!/^\s*\)\.join\(\s*(?:""|'')\s*\)/.test(content.slice(template.endIndex + 1))) {
		return false;
	}
	const safeNames = collectSafeHtmlNames(content, rhsStart);
	return templateExpressions(template.body).every((expr) => isSafeHtmlExpression(expr, safeNames));
};

export const isSafeInnerHtmlAssignment = (content: string, matchIndex: number): boolean => {
	const tail = content.slice(matchIndex);
	if (SAFE_EMPTY_INNER_HTML_RE.test(tail) || SAFE_SANITIZED_INNER_HTML_RE.test(tail)) return true;

	const rhsStart = assignmentRhsStart(content, matchIndex);
	if (rhsStart === null) return false;
	const first = content[rhsStart];
	const safeNames = collectSafeHtmlNames(content, matchIndex);
	const singleLineRhs = readSingleLineRhs(content, rhsStart);
	if (isSafeHtmlExpression(singleLineRhs, safeNames)) return true;
	if (isSafeMapJoinHtmlAssignment(content, rhsStart)) return true;

	if (first === "'" || first === '"') {
		const quoted = consumeQuotedLiteral(content, rhsStart, first);
		return Boolean(quoted && assignmentTailIsClosed(content, quoted.endIndex));
	}

	if (first !== "`") return false;
	const template = consumeTemplateLiteral(content, rhsStart);
	if (!template || !assignmentTailIsClosed(content, template.endIndex)) return false;
	const expressions = templateExpressions(template.body);
	if (expressions.length === 0) return true;
	return expressions.every((expr) => isSafeHtmlExpression(expr, safeNames));
};
