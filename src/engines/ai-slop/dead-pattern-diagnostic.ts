import type { Diagnostic } from "../types.js";

export const slop = (
	filePath: string,
	line: number,
	rule: string,
	severity: Diagnostic["severity"],
	message: string,
	help: string,
	fixable: boolean,
): Diagnostic => ({
	filePath,
	engine: "ai-slop",
	rule,
	severity,
	message,
	help,
	line,
	column: 0,
	category: "AI Slop",
	fixable,
});
