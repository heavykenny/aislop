import fs from "node:fs";
import path from "node:path";
import type { EngineContext } from "../types.js";
import { detectTrivialComments } from "./comments.js";
import { detectDeadPatterns } from "./dead-patterns.js";

/**
 * Removes lines flagged as fixable by the trivial-comment and dead-pattern detectors.
 * Specifically handles:
 *   - ai-slop/trivial-comment  (trivial comments that restate the code)
 *   - ai-slop/console-leftover (console.log/debug/info left in production)
 */
export const fixDeadPatterns = async (context: EngineContext): Promise<void> => {
	const diagnostics = [
		...(await detectTrivialComments(context)),
		...(await detectDeadPatterns(context)),
	];

	const fixable = diagnostics.filter((d) => d.fixable);
	if (fixable.length === 0) return;

	const byFile = new Map<string, Set<number>>();
	for (const d of fixable) {
		const absolute = path.isAbsolute(d.filePath)
			? d.filePath
			: path.join(context.rootDirectory, d.filePath);
		const lines = byFile.get(absolute) ?? new Set<number>();
		lines.add(d.line);
		byFile.set(absolute, lines);
	}

	for (const [filePath, lineNumbers] of byFile) {
		if (!fs.existsSync(filePath)) continue;

		const content = fs.readFileSync(filePath, "utf-8");
		const lines = content.split("\n");
		const filtered: string[] = [];

		for (let i = 0; i < lines.length; i++) {
			const lineNo = i + 1;
			if (lineNumbers.has(lineNo)) {
				// Skip blank line left behind if previous line is also blank
				continue;
			}
			filtered.push(lines[i]);
		}

		// Collapse consecutive blank lines left by removals
		const collapsed: string[] = [];
		for (const line of filtered) {
			if (
				line.trim() === "" &&
				collapsed.length > 0 &&
				collapsed[collapsed.length - 1].trim() === ""
			) {
				continue;
			}
			collapsed.push(line);
		}

		fs.writeFileSync(filePath, collapsed.join("\n"));
	}
};
