import fs from "node:fs";
import path from "node:path";
import { getSourceFiles } from "../../utils/source-files.js";
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

const RISKY_PATTERNS: RiskyPattern[] = [
	{
		pattern: new RegExp(`\\b${ev}\\s*\\(`, "g"),
		extensions: [
			".ts",
			".tsx",
			".js",
			".jsx",
			".mjs",
			".cjs",
			".py",
			".rb",
			".php",
		],
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
		pattern: /\.innerHTML\s*=/g,
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
		pattern: new RegExp(`\\b${"ex" + "ec"}\\s*\\(`, "g"),
		extensions: [".py"],
		name: "python-exec",
		message: "Use of exec() can execute arbitrary code",
		help: "Avoid exec — use safer alternatives",
	},
	{
		pattern:
			/(?:child_process|subprocess|os\.system|exec|spawn)\s*\([^)]*\$\{/g,
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"],
		name: "shell-injection",
		message: "Possible shell injection — user input in command execution",
		help: "Use parameterized commands or a safe shell execution library",
	},
	{
		pattern: /(?:query|execute|raw)\s*\(\s*`[^`]*\$\{/g,
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		name: "sql-injection",
		message: "Possible SQL injection — template literal in query",
		help: "Use parameterized queries or an ORM instead of string interpolation",
	},
	{
		pattern: /(?:query|execute|raw)\s*\(\s*["'][^"']*["']\s*\+/g,
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		name: "sql-injection",
		message: "Possible SQL injection — string concatenation in query",
		help: "Use parameterized queries or an ORM instead of string concatenation",
	},
];

export const detectRiskyConstructs = async (
	context: EngineContext,
): Promise<Diagnostic[]> => {
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
		const isMigrationOrSeeder =
			/(?:^|\/)(migrations|seeders|seeds|migrate)\//.test(normalizedPath);

		for (const { pattern, extensions, name, message, help } of RISKY_PATTERNS) {
			if (!extensions.includes(ext)) continue;
			if (isMigrationOrSeeder && name === "sql-injection") continue;

			const regex = new RegExp(pattern.source, pattern.flags);
			let match: RegExpExecArray | null;

			while ((match = regex.exec(content)) !== null) {
				const line = content.slice(0, match.index).split("\n").length;

				// For SQL injection: skip if interpolation is clearly safe
				if (name === "sql-injection") {
					const afterMatch = content.slice(
						match.index + match[0].length,
						match.index + match[0].length + 100,
					);
					// Skip if interpolation is .join(), a constant-like name, or array method
					if (
						/^(?:\w+\.join\s*\(|[A-Z_]+\}|tableName\}|table\})/.test(afterMatch)
					) {
						continue;
					}
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
