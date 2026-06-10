import fs from "node:fs";
import path from "node:path";
import { getSourceFiles } from "../../utils/source-files.js";
import { maskStringsAndComments } from "../../utils/source-masker.js";
import type { Diagnostic, EngineContext } from "../types.js";
import { consumeTemplateLiteral, isSafeInnerHtmlAssignment } from "./html-safety.js";

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
		const masked = maskStringsAndComments(content, ext);
		const lines = content.split("\n");

		for (const { pattern, extensions, name, message, help } of RISKY_PATTERNS) {
			if (!extensions.includes(ext)) continue;

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
