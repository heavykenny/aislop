import fs from "node:fs";
import path from "node:path";
import { getSourceFiles } from "../../utils/source-files.js";
import type { Diagnostic, EngineContext } from "../types.js";

// Patterns that indicate AI-generated trivial comments
const TRIVIAL_COMMENT_PATTERNS = [
	// "This function does X" when function name already says X
	/\/\/\s*This (?:function|method|class|variable|constant) (?:will |is used to |is responsible for )?/i,
	// "Import X" above an import statement
	/\/\/\s*Import(?:ing|s)?\s+/i,
	// "Define X" above a definition
	/\/\/\s*Defin(?:e|ing)\s+(?:the\s+)?/i,
	// "Initialize X" above an initialization
	/\/\/\s*Initializ(?:e|ing)\s+(?:the\s+)?/i,
	// "Set X to Y"
	/\/\/\s*Set(?:ting)?\s+\w+\s+to\s+/i,
	// "Return X"
	/\/\/\s*Return(?:ing|s)?\s+(?:the\s+)?/i,
	// "Check if X"
	/\/\/\s*Check(?:ing)?\s+(?:if|whether)\s+/i,
	// "Loop through X" / "Iterate over X"
	/\/\/\s*(?:Loop(?:ing)?\s+through|Iterat(?:e|ing)\s+over)\s+/i,
	// "Create X" above a creation
	/\/\/\s*Creat(?:e|ing)\s+(?:a\s+(?:new\s+)?)?/i,
	// "Update X"
	/\/\/\s*Updat(?:e|ing)\s+(?:the\s+)?/i,
	// "Delete X" / "Remove X"
	/\/\/\s*(?:Delet|Remov)(?:e|ing)\s+(?:the\s+)?/i,
	// "Handle X"
	/\/\/\s*Handl(?:e|ing)\s+(?:the\s+)?/i,
	// "Get X" / "Fetch X"
	/\/\/\s*(?:Get(?:ting)?|Fetch(?:ing)?)\s+(?:the\s+)?/i,
	// "Increment/Decrement X"
	/\/\/\s*(?:Increment|Decrement)(?:ing)?\s+/i,
	// Python equivalents
	/^#\s*This (?:function|method|class) (?:will |is used to )?/i,
	/^#\s*(?:Import|Define|Initialize|Return|Check|Create|Update|Delete|Handle|Get|Fetch)/i,
];

const isTrivialComment = (line: string): boolean =>
	TRIVIAL_COMMENT_PATTERNS.some((pattern) => pattern.test(line));

const scanFileForTrivialComments = (
	content: string,
	relativePath: string,
): Diagnostic[] => {
	const diagnostics: Diagnostic[] = [];
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (!isTrivialComment(lines[i].trim())) continue;
		diagnostics.push({
			filePath: relativePath,
			engine: "ai-slop",
			rule: "ai-slop/trivial-comment",
			severity: "warning",
			message: "Trivial comment that restates the code",
			help: "Remove comments that don't add information beyond what the code already expresses",
			line: i + 1,
			column: 0,
			category: "AI Slop",
			fixable: true,
		});
	}
	return diagnostics;
};

export const detectTrivialComments = async (
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

		const relativePath = path.relative(context.rootDirectory, filePath);
		diagnostics.push(...scanFileForTrivialComments(content, relativePath));
	}

	return diagnostics;
};
