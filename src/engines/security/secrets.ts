import fs from "node:fs";
import path from "node:path";
import { getSourceFilesWithExtras } from "../../utils/source-files.js";
import { maskComments } from "../../utils/source-masker.js";
import type { Diagnostic, EngineContext } from "../types.js";

interface SecretPattern {
	pattern: RegExp;
	name: string;
	// Skip the match when the keyword sits inside a string literal (prose, not an identifier).
	keywordPrefixed?: boolean;
}

const SECRET_PATTERNS: SecretPattern[] = [
	// API Keys
	{
		pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']([A-Za-z0-9_-]{20,})["']/gi,
		name: "API key",
		keywordPrefixed: true,
	},
	// AWS
	{ pattern: /AKIA[0-9A-Z]{16}/g, name: "AWS Access Key" },
	{
		pattern: /(?:aws[_-]?secret|secret[_-]?key)\s*[:=]\s*["']([A-Za-z0-9/+=]{40})["']/gi,
		name: "AWS Secret Key",
		keywordPrefixed: true,
	},
	// Generic secrets/passwords
	{
		pattern: /(?:password|passwd|pwd|secret)\s*[:=]\s*["']([^"']{8,})["']/gi,
		name: "Hardcoded password/secret",
		keywordPrefixed: true,
	},
	// Private keys
	{
		pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
		name: "Private key",
	},
	// JWT tokens
	{
		pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
		name: "JWT token",
	},
	// Generic tokens
	{
		pattern: /(?:token|bearer)\s*[:=]\s*["']([A-Za-z0-9_-]{20,})["']/gi,
		name: "Authentication token",
		keywordPrefixed: true,
	},
	// GitHub tokens
	{ pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, name: "GitHub token" },
	// Slack tokens
	{ pattern: /xox[baprs]-[A-Za-z0-9-]+/g, name: "Slack token" },
	// Database URLs
	{
		pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^"'\s]+:[^"'\s]+@/gi,
		name: "Database connection string with credentials",
	},
];

const isInsideStringLiteral = (content: string, matchIndex: number): boolean => {
	const lineStart = content.lastIndexOf("\n", matchIndex - 1) + 1;
	const prefix = content.slice(lineStart, matchIndex);
	let inDouble = false;
	let inSingle = false;
	let inBacktick = false;
	for (let i = 0; i < prefix.length; i++) {
		const ch = prefix[i];
		if (ch === "\\") {
			i++;
			continue;
		}
		if (ch === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
		else if (ch === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
		else if (ch === "`" && !inDouble && !inSingle) inBacktick = !inBacktick;
	}
	return inDouble || inSingle || inBacktick;
};

const PLACEHOLDER_EXACT = new Set(["changeme", "password", "secret", "xxx", "todo", "replace_me"]);
const PLACEHOLDER_URL_PARTS = new Set([
	"example",
	"host",
	"localhost",
	"pass",
	"password",
	"pw",
	"user",
	"username",
]);

const isPlaceholderCredentialUrl = (matchedText: string): boolean => {
	const credentialMatch = matchedText.match(/^[a-z]+:\/\/([^:@/\s]+):([^@/\s]+)@/i);
	if (credentialMatch) {
		return (
			PLACEHOLDER_URL_PARTS.has(credentialMatch[1].toLowerCase()) &&
			PLACEHOLDER_URL_PARTS.has(credentialMatch[2].toLowerCase())
		);
	}

	try {
		const parsed = new URL(matchedText);
		return (
			PLACEHOLDER_URL_PARTS.has(parsed.username.toLowerCase()) &&
			PLACEHOLDER_URL_PARTS.has(parsed.password.toLowerCase()) &&
			PLACEHOLDER_URL_PARTS.has(parsed.hostname.toLowerCase())
		);
	} catch {
		return false;
	}
};

const isPlaceholderValue = (matchedText: string): boolean => {
	if (isPlaceholderCredentialUrl(matchedText)) return true;
	if (/env\(/i.test(matchedText)) return true;
	if (matchedText.includes("process.env")) return true;
	if (matchedText.includes("os.environ")) return true;
	if (matchedText.includes("${")) return true;
	if (matchedText.includes("<") && matchedText.includes(">")) return true;
	if (/^your_/i.test(matchedText)) return true;
	if (PLACEHOLDER_EXACT.has(matchedText.toLowerCase())) return true;
	return false;
};

export const scanSecrets = async (context: EngineContext): Promise<Diagnostic[]> => {
	const files = getSourceFilesWithExtras(context, [".env", ".yaml", ".yml", ".json", ".toml"]);
	const diagnostics: Diagnostic[] = [];

	for (const filePath of files) {
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		// A secret inside a JSDoc @example is documentation, not a leak.
		content = maskComments(content, path.extname(filePath));

		const relativePath = path.relative(context.rootDirectory, filePath);

		for (const { pattern, name, keywordPrefixed } of SECRET_PATTERNS) {
			const regex = new RegExp(pattern.source, pattern.flags);

			for (const match of content.matchAll(regex)) {
				const matchedText = match[1] ?? match[0];
				if (isPlaceholderValue(matchedText)) continue;
				if (keywordPrefixed && isInsideStringLiteral(content, match.index)) continue;

				const line = content.slice(0, match.index).split("\n").length;

				diagnostics.push({
					filePath: relativePath,
					engine: "security",
					rule: "security/hardcoded-secret",
					severity: "error",
					message: `Possible ${name} detected in source code`,
					help: "Move secrets to environment variables or a secrets manager",
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
