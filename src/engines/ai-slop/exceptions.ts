import fs from "node:fs";
import path from "node:path";
import { getSourceFiles } from "../../utils/source-files.js";
import type { Diagnostic, EngineContext } from "../types.js";

// Patterns for swallowed exceptions across languages
const SWALLOWED_EXCEPTION_PATTERNS: Array<{
	pattern: RegExp;
	languages: string[];
	message: string;
}> = [
	// JS/TS: catch with empty block or just comment
	{
		pattern: /catch\s*\([^)]*\)\s*\{\s*(?:\/\/[^\n]*)?\s*\}/,
		languages: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		message: "Empty catch block swallows errors silently",
	},
	// JS/TS: catch with only console.log (often AI pattern)
	{
		pattern: /catch\s*\([^)]*\)\s*\{\s*console\.log\([^)]*\);\s*\}/,
		languages: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		message: "Catch block only logs error without proper handling",
	},
	// Python: bare except/except Exception with pass
	{
		pattern: /except(?:\s+\w+)?:\s*\n\s*pass/,
		languages: [".py"],
		message: "Bare except with pass swallows errors silently",
	},
	// Python: except Exception as e with just print
	{
		pattern: /except\s+\w+(?:\s+as\s+\w+)?:\s*\n\s*print\(/,
		languages: [".py"],
		message: "Catch block only prints error without proper handling",
	},
	// Go: ignoring error return
	{
		pattern: /\w+,\s*_\s*:?=\s*\w+\(/,
		languages: [".go"],
		message: "Error return value is being ignored",
	},
	// Ruby: rescue with no handling
	{
		pattern: /rescue(?:\s+\w+)?\s*(?:=>?\s*\w+)?\s*\n\s*(?:nil|#)/,
		languages: [".rb"],
		message: "Rescue block swallows errors silently",
	},
	// Java: catch with empty block
	{
		pattern: /catch\s*\(\w+\s+\w+\)\s*\{\s*(?:\/\/[^\n]*)?\s*\}/,
		languages: [".java"],
		message: "Empty catch block swallows errors silently",
	},
];

export const detectSwallowedExceptions = async (
	context: EngineContext,
): Promise<Diagnostic[]> => {
	const files = getSourceFiles(context);
	const diagnostics: Diagnostic[] = [];

	for (const filePath of files) {
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const ext = path.extname(filePath);
		const relativePath = path.relative(context.rootDirectory, filePath);

		// Check swallowed exceptions
		for (const {
			pattern,
			languages,
			message,
		} of SWALLOWED_EXCEPTION_PATTERNS) {
			if (!languages.includes(ext)) continue;

			let match: RegExpExecArray | null;
			const regex = new RegExp(
				pattern.source,
				pattern.flags + (pattern.flags.includes("g") ? "" : "g"),
			);

			while ((match = regex.exec(content)) !== null) {
				const line = content.slice(0, match.index).split("\n").length;
				diagnostics.push({
					filePath: relativePath,
					engine: "ai-slop",
					rule: "ai-slop/swallowed-exception",
					severity: "error",
					message,
					help: "Handle errors explicitly: log with context, rethrow, or return an error value",
					line,
					column: 0,
					category: "AI Slop",
					fixable: false,
				});
			}
		}
	}

	return diagnostics;
};
