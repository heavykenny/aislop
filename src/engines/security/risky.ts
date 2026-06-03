import fs from "node:fs";
import path from "node:path";
import { getSourceFiles } from "../../utils/source-files.js";
import { maskStringsAndComments } from "../../utils/source-masker.js";
import type { Diagnostic, EngineContext } from "../types.js";

interface RiskyPattern {
	pattern: RegExp;
	extensions: string[];
	name: string;
	message: string;
	help: string;
}

// Build patterns using string concatenation to avoid self-detection
const ev = "ev" + "al";
const Fn = "Func" + "tion";

const DB_RECEIVER =
	"(?:db|database|knex|client|connection|conn|pool|sql|prisma|trx|tx|sequelize|mongoose|typeorm|postgres|pg|mysql|sqlite|model|orm|datasource)";
const DB_METHOD =
	"(?:query|execute|exec|raw|\\$queryRaw|\\$queryRawUnsafe|\\$executeRaw|\\$executeRawUnsafe)";

const RISKY_PATTERNS: RiskyPattern[] = [
	{
		// Negative lookbehind skips method-call forms (`.eval(`, `->eval(`, `::eval(`, `\eval(`)
		// which are not the global eval — common in PHP (Redis Lua), Ruby (binding.eval), JS (custom methods).
		pattern: new RegExp(`(?<![\\w.>:\\\\])\\b${ev}\\s*\\(`, "g"),
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".php"],
		name: "eval",
		message: `Use of ${ev}() is a security risk`,
		help: `Avoid ${ev} — use safer alternatives like JSON.parse, Function constructor, or AST-based approaches`,
	},
	{
		pattern: new RegExp(`new\\s+${Fn}\\s*\\(`, "g"),
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		name: "new-function",
		message: `Use of new ${Fn}() is similar to ${ev} and can be a security risk`,
		help: "Avoid dynamic code execution — refactor to use static code paths",
	},
	{
		pattern: new RegExp(`\\.inner${""}HTML\\s*=`, "g"),
		extensions: [".ts", ".tsx", ".js", ".jsx"],
		name: "innerhtml",
		message: "Direct innerHTML assignment can lead to XSS",
		help: "Use textContent, DOM APIs, or a sanitization library instead",
	},
	{
		pattern: /dangerouslySetInnerHTML/g,
		extensions: [".tsx", ".jsx"],
		name: "dangerously-set-innerhtml",
		message: "dangerouslySetInnerHTML can lead to XSS if not sanitized",
		help: "Ensure the HTML is sanitized with DOMPurify or similar before rendering",
	},
	{
		pattern: /pickle\.loads?\s*\(/g,
		extensions: [".py"],
		name: "pickle-load",
		message: "pickle.load can execute arbitrary code — unsafe deserialization",
		help: "Use JSON, MessagePack, or other safe serialization formats for untrusted data",
	},
	{
		// Negative lookbehind skips method-call forms (`.exec(`, `->exec(`, `::exec(`, `\exec(`)
		// which are not the builtin exec — e.g. SQLModel's session.exec(stmt) or RegExp.exec.
		pattern: new RegExp(`(?<![\\w.>:\\\\])\\b${"ex" + "ec"}\\s*\\(`, "g"),
		extensions: [".py"],
		name: "python-exec",
		message: "Use of exec() can execute arbitrary code",
		help: "Avoid exec — use safer alternatives",
	},
	{
		pattern: /(?:child_process|subprocess|os\.system|exec|spawn)\s*\([^)]*\$\{/g,
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"],
		name: "shell-injection",
		message: "Possible shell injection — user input in command execution",
		help: "Use parameterized commands or a safe shell execution library",
	},
	{
		// Flags db-handle template-literal queries with interpolation (tagged or called).
		pattern: new RegExp(
			`\\b${DB_RECEIVER}(?:\\.\\w+)*\\.${DB_METHOD}\\s*\\(?\\s*\`[^\`]*\\$\\{`,
			"g",
		),
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		name: "sql-injection",
		message: "Possible SQL injection — template literal in query",
		help: "Use parameterized queries or an ORM instead of string interpolation",
	},
	{
		// Flags db-handle string-concatenated queries.
		pattern: new RegExp(
			`\\b${DB_RECEIVER}(?:\\.\\w+)*\\.${DB_METHOD}\\s*\\(\\s*["'][^"']*["']\\s*\\+`,
			"g",
		),
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		name: "sql-injection",
		message: "Possible SQL injection — string concatenation in query",
		help: "Use parameterized queries or an ORM instead of string concatenation",
	},
];

const hasDangerouslySetInnerHtmlIgnore = (lines: string[], lineIndex: number): boolean => {
	const start = Math.max(0, lineIndex - 2);
	return lines
		.slice(start, lineIndex + 1)
		.some((line) =>
			/(?:biome-ignore|eslint-disable|aislop-ignore).*(?:noDangerouslySetInnerHtml|dangerouslySetInnerHTML|dangerously-set-innerhtml)/i.test(
				line,
			),
		);
};

const isStructuredDataScript = (content: string, matchIndex: number): boolean => {
	const before = content.slice(Math.max(0, matchIndex - 300), matchIndex);
	if (/type=["']application\/ld\+json["']/.test(before)) return true;

	const after = content.slice(matchIndex, Math.min(content.length, matchIndex + 180));
	return /__html\s*:\s*JSON\.stringify\s*\(/.test(after);
};

const SAFE_EMPTY_INNER_HTML_RE = /^\.innerHTML\s*=\s*(?:""|''|``)\s*;?/;
const SAFE_SANITIZED_INNER_HTML_RE =
	/^\.innerHTML\s*=\s*(?:escapeHtml|sanitizeHtml|sanitizeHTML|DOMPurify\.sanitize)\s*\([^;\n]*\)\s*;?(?:\n|$)/;
const SANITIZER_EXPR_RE =
	/^(?:escapeHtml|escapeHTML|sanitizeHtml|sanitizeHTML|DOMPurify\.sanitize)\s*\([^;\n]*\)$/;
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const STATIC_STRING_RE = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\$])*`)$/;

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

const consumeTemplateLiteral = (
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

const collectSafeHtmlNames = (content: string, matchIndex: number): Set<string> => {
	const safeNames = new Set<string>();
	const prefix = content.slice(Math.max(0, matchIndex - 8000), matchIndex);
	const declarations = [...prefix.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+);?/g)].map(
		(match) => ({ name: match[1], expr: match[2].trim() }),
	);

	let changed = true;
	while (changed) {
		changed = false;
		for (const { name, expr } of declarations) {
			if (safeNames.has(name)) continue;
			if (
				STATIC_STRING_RE.test(expr) ||
				SANITIZER_EXPR_RE.test(expr) ||
				staticTernaryRe.test(expr) ||
				(IDENT_RE.test(expr) && safeNames.has(expr))
			) {
				safeNames.add(name);
				changed = true;
			}
		}
	}
	return safeNames;
};

const isSafeHtmlExpression = (expr: string, safeNames: Set<string>): boolean => {
	if (SANITIZER_EXPR_RE.test(expr)) return true;
	if (STATIC_STRING_RE.test(expr)) return true;
	if (staticTernaryRe.test(expr)) return true;
	if (/^(?:Math\.\w+|Number|parseInt|parseFloat)\s*\(/.test(expr)) return true;
	if (IDENT_RE.test(expr) && safeNames.has(expr)) return true;
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

const isSafeInnerHtmlAssignment = (content: string, matchIndex: number): boolean => {
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

const isSafeShellSpawnArray = (content: string, matchIndex: number): boolean =>
	/^spawn\s*\(\s*\[/.test(content.slice(matchIndex)) &&
	!/^\s*spawn\s*\(\s*\[\s*["'](?:sh|bash|zsh|cmd|cmd\.exe|powershell|pwsh)["']\s*,\s*["'](?:-c|\/c|\/C)["']/i.test(
		content.slice(matchIndex),
	) &&
	!/shell\s*:\s*true\b/.test(content.slice(matchIndex, matchIndex + 500));

const PLACEHOLDER_EXPR_RE =
	/^(?:placeholders?|placeholderList|bindMarkers?|bindingMarkers?|bindPlaceholders?|bindingPlaceholders?|parameterPlaceholders?|sqlPlaceholders?)(?:\.\w+\([^)]*\))?$/i;
const SQL_PLACEHOLDER_LITERAL_RE = /["'](?:\?|\$\d+|\$\{[^}]+\})["']/;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isGeneratedPlaceholderList = (
	content: string,
	matchIndex: number,
	placeholderExpr: string,
): boolean => {
	const name = placeholderExpr.match(/^([A-Za-z_$][\w$]*)/)?.[1];
	if (!name) return false;

	const prefix = content.slice(Math.max(0, matchIndex - 4000), matchIndex);
	const declarationRe = new RegExp(
		`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=\\s*([^;\\n]+)`,
		"g",
	);
	const declarations = [...prefix.matchAll(declarationRe)];
	const declaration = declarations.at(-1);
	if (!declaration) return false;

	const expr = declaration[1];
	if (!/\.join\s*\(/.test(expr)) return false;
	return (
		(/\.map\s*\(/.test(expr) && /=>/.test(expr) && SQL_PLACEHOLDER_LITERAL_RE.test(expr)) ||
		(/\.fill\s*\(/.test(expr) && SQL_PLACEHOLDER_LITERAL_RE.test(expr))
	);
};

const isSafeSqlPlaceholderTemplate = (content: string, matchIndex: number): boolean => {
	const template = consumeTemplateLiteral(content, matchIndex);
	if (!template) return false;
	const afterTemplate = content.slice(template.endIndex + 1);
	const hasSeparateBindings =
		/^\s*,/.test(afterTemplate) || /^\s*\)\s*\.(?:all|get|run|values)\s*\(/.test(afterTemplate);
	if (!hasSeparateBindings) return false;

	const expressions = [...template.body.matchAll(/\$\{\s*([^}]+?)\s*\}/g)].map((match) =>
		match[1].trim(),
	);
	if (expressions.length === 0) return false;
	return expressions.every(
		(expr) =>
			PLACEHOLDER_EXPR_RE.test(expr) && isGeneratedPlaceholderList(content, matchIndex, expr),
	);
};

export const detectRiskyConstructs = async (context: EngineContext): Promise<Diagnostic[]> => {
	const files = getSourceFiles(context);
	const diagnostics: Diagnostic[] = [];

	for (const filePath of files) {
		const ext = path.extname(filePath);

		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const relativePath = path.relative(context.rootDirectory, filePath);
		const normalizedPath = relativePath.split(path.sep).join("/");
		const isMigrationOrSeeder = /(?:^|\/)(migrations|seeders|seeds|migrate)\//.test(normalizedPath);
		const masked = maskStringsAndComments(content, ext);
		const lines = content.split("\n");

		for (const { pattern, extensions, name, message, help } of RISKY_PATTERNS) {
			if (!extensions.includes(ext)) continue;
			if (isMigrationOrSeeder && name === "sql-injection") continue;

			const regex = new RegExp(pattern.source, pattern.flags);

			for (const match of masked.matchAll(regex)) {
				const line = content.slice(0, match.index).split("\n").length;

				// For innerHTML: skip if target is a <template> element (safe by design)
				if (name === "innerhtml") {
					const beforeMatch = content.slice(Math.max(0, match.index - 200), match.index);
					if (isSafeInnerHtmlAssignment(content, match.index)) continue;
					if (
						/(?:template|tmpl|tpl)$/i.test(beforeMatch.trimEnd()) ||
						/createElement\s*\(\s*['"]template['"]\s*\)$/.test(beforeMatch.trimEnd())
					) {
						continue;
					}
				}

				if (name === "sql-injection" && isSafeSqlPlaceholderTemplate(content, match.index)) {
					continue;
				}

				if (name === "shell-injection" && isSafeShellSpawnArray(content, match.index)) {
					continue;
				}

				if (name === "dangerously-set-innerhtml") {
					if (hasDangerouslySetInnerHtmlIgnore(lines, line - 1)) continue;
					if (isStructuredDataScript(content, match.index)) continue;
				}

				diagnostics.push({
					filePath: relativePath,
					engine: "security",
					rule: `security/${name}`,
					severity: "error",
					message,
					help,
					line,
					column: 0,
					category: "Security",
					fixable: false,
				});
			}
		}
	}

	return diagnostics;
};
