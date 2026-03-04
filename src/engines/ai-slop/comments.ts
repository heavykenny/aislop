import fs from "node:fs";
import path from "node:path";
import { getSourceFiles } from "../../utils/source-files.js";
import type { Diagnostic, EngineContext } from "../types.js";

// Patterns that indicate AI-generated trivial comments
const TRIVIAL_JS_COMMENT_PATTERNS = [
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
];

const TRIVIAL_PYTHON_COMMENT_PATTERNS = [
	/^#\s*This (?:function|method|class) (?:will |is used to )?/i,
	/^#\s*(?:Import|Define|Initialize|Return|Check|Create|Update|Delete|Handle|Get|Fetch)/i,
];

// Keywords that indicate a comment is explanatory / meaningful
const EXPLANATORY_KEYWORDS =
	/\b(?:because|since|note|todo|fixme|hack|warn|warning|workaround|caveat|important|assumes?)\b/i;

// Characters that suggest commented-out code rather than prose
const COMMENTED_CODE_CHARS = /[({=;}\]>]/;

const MAX_TRIVIAL_COMMENT_LENGTH = 60;

const isJsComment = (trimmed: string): boolean => trimmed.startsWith("//");
const isPythonComment = (trimmed: string): boolean =>
	trimmed.startsWith("#") && !trimmed.startsWith("#!");

/**
 * Extract just the comment text after the comment marker.
 */
const getCommentBody = (trimmed: string): string => {
	if (trimmed.startsWith("//")) return trimmed.slice(2).trim();
	if (trimmed.startsWith("#")) return trimmed.slice(1).trim();
	return trimmed;
};

const isTrivialComment = (
	trimmed: string,
	nextLine: string | undefined,
): boolean => {
	const isJs = isJsComment(trimmed);
	const isPy = isPythonComment(trimmed);
	if (!isJs && !isPy) return false;

	const commentBody = getCommentBody(trimmed);

	// Skip long comments — they likely contain meaningful context
	if (commentBody.length > MAX_TRIVIAL_COMMENT_LENGTH) return false;

	// Skip comments with explanatory keywords
	if (EXPLANATORY_KEYWORDS.test(commentBody)) return false;

	// Skip parenthetical explanations like "(excluding ignored directories)"
	if (commentBody.includes("(") && commentBody.includes(")")) return false;

	// Skip commented-out code (contains code-like characters)
	if (COMMENTED_CODE_CHARS.test(commentBody)) return false;

	// Skip section dividers (followed by a blank line)
	if (nextLine !== undefined && nextLine.trim() === "") return false;

	// Now check against the actual trivial patterns
	const patterns = isJs
		? TRIVIAL_JS_COMMENT_PATTERNS
		: TRIVIAL_PYTHON_COMMENT_PATTERNS;
	return patterns.some((pattern) => pattern.test(trimmed));
};

const scanFileForTrivialComments = (
	content: string,
	relativePath: string,
): Diagnostic[] => {
	const diagnostics: Diagnostic[] = [];
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		const nextLine = i + 1 < lines.length ? lines[i + 1] : undefined;
		if (!isTrivialComment(trimmed, nextLine)) continue;
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
