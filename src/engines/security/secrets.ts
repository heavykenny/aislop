import fs from "node:fs";
import path from "node:path";
import { getSourceFilesWithExtras } from "../../utils/source-files.js";
import type { Diagnostic, EngineContext } from "../types.js";

const SECRET_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
	// API Keys
	{
		pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']([A-Za-z0-9_-]{20,})["']/gi,
		name: "API key",
	},
	// AWS
	{ pattern: /AKIA[0-9A-Z]{16}/g, name: "AWS Access Key" },
	{
		pattern:
			/(?:aws[_-]?secret|secret[_-]?key)\s*[:=]\s*["']([A-Za-z0-9/+=]{40})["']/gi,
		name: "AWS Secret Key",
	},
	// Generic secrets/passwords
	{
		pattern: /(?:password|passwd|pwd|secret)\s*[:=]\s*["']([^"']{8,})["']/gi,
		name: "Hardcoded password/secret",
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

export const scanSecrets = async (
	context: EngineContext,
): Promise<Diagnostic[]> => {
	const files = getSourceFilesWithExtras(context, [
		".env",
		".yaml",
		".yml",
		".json",
		".toml",
	]);
	const diagnostics: Diagnostic[] = [];

	for (const filePath of files) {
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const relativePath = path.relative(context.rootDirectory, filePath);

		for (const { pattern, name } of SECRET_PATTERNS) {
			const regex = new RegExp(pattern.source, pattern.flags);
			let match: RegExpExecArray | null;

			while ((match = regex.exec(content)) !== null) {
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
