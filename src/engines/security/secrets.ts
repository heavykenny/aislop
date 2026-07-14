import fs from "node:fs";
import path from "node:path";
import { relativePosix } from "../../utils/paths.js";
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
		pattern: /(?:mongodb(?:\+srv)?|postgres|mysql|redis):\/\/[^:@/"'`\s]+:[^@"'`\s]+@[^"'`\s]+/gi,
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
const ENV_PLACEHOLDER_RE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
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
const PUBLIC_POSTHOG_PROJECT_TOKEN_RE = /^phc_[A-Za-z0-9_-]{20,}$/;
const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const NON_PRODUCTION_CREDENTIAL_EXACT = new Set(["pass", "password", "pw", "mostest"]);
const NON_PRODUCTION_CREDENTIAL_PREFIXES = [
	"demo",
	"dummy",
	"fake",
	"local",
	"sample",
	"test",
	"testing",
] as const;

const isNonProductionCredentialValue = (value: string): boolean => {
	const lower = value.toLowerCase();
	const prefix = NON_PRODUCTION_CREDENTIAL_PREFIXES.find((candidate) =>
		lower.startsWith(candidate),
	);
	if (!prefix) return false;

	let rest = lower.slice(prefix.length);
	if (rest.length === 0) return true;

	while (rest.length > 0) {
		if (rest[0] === "_" || rest[0] === "." || rest[0] === "-") {
			rest = rest.slice(1);
			if (rest.length === 0) return false;
		}
		const segment = rest.match(/^[a-z0-9]+/);
		if (!segment) return false;
		rest = rest.slice(segment[0].length);
	}

	return true;
};

const NON_PRODUCTION_SECRET_PATH_RE =
	/(?:^|\/)(?:__fixtures__|__mocks__|cypress|demo|demos|e2e-tests?|examples?|fixtures?|playwright|samples?|seeders?|seeds?|storetest|testdata|tests?|tools\/sharedchannel-test)(?:\/|$)|(?:^|\/)db\/seeds\.[^/]+$/i;
const SYMBOLIC_VALUE_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const HEADER_CONSTANT_RE = /\bHeader[A-Za-z0-9_]*\s*=/;
const GENERATED_SECRET_RE =
	/\b(?:SecureRandom|crypto\.random|randomBytes|randomUUID|random_bytes|secrets\.token|uuid)\b/i;
const FIXTURE_LINE_RE = /\b(?:fixture|mock|sample|seed|test)\b|(?:^|[^A-Za-z])B?Test[A-Z_]/i;
const FIXTURE_VALUE_RE =
	/^(?:password1!?\.?|passwd\+us3r\d+|sys@dmin-sample\d+|usr@mmtest\d+|test(?:ing)?[-_ ]?(?:password|secret)?\d*)$/i;
const MASKED_SECRET_RE = /^[*xX]{6,}$/;

const isPlaceholderCredentialUrl = (matchedText: string): boolean => {
	const credentialMatch = matchedText.match(/^[a-z][a-z+.-]*:\/\/([^:@/\s]+):([^@/\s]+)@/i);
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

const isLocalhostExampleDatabaseUrl = (matchedText: string): boolean => {
	try {
		const parsed = new URL(matchedText);
		if (!LOCAL_DB_HOSTS.has(parsed.hostname.toLowerCase())) return false;
		const password = decodeURIComponent(parsed.password);
		const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
		return (
			NON_PRODUCTION_CREDENTIAL_EXACT.has(password.toLowerCase()) ||
			isNonProductionCredentialValue(password) ||
			/(?:^|[_-])test(?:$|[_-])|sample|fixture/i.test(database)
		);
	} catch {
		return false;
	}
};

const lineForMatch = (content: string, matchIndex: number): string => {
	const lineStart = content.lastIndexOf("\n", matchIndex - 1) + 1;
	const lineEnd = content.indexOf("\n", matchIndex);
	return content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
};

const isPlaceholderValue = (matchedText: string): boolean => {
	const value = matchedText.trim();
	if (isPlaceholderCredentialUrl(value)) return true;
	if (ENV_PLACEHOLDER_RE.test(value)) return true;
	if (PLACEHOLDER_EXACT.has(value.toLowerCase())) return true;
	return false;
};

const isSymbolicConstantValue = (matchedText: string): boolean => {
	if (/^process\.env\./i.test(matchedText)) return false;
	if (!SYMBOLIC_VALUE_RE.test(matchedText)) return false;
	if (/\d/.test(matchedText)) return false;
	return /[_.]/.test(matchedText) || /[a-z][A-Z]/.test(matchedText);
};

const isHeaderNameConstant = (lineText: string, matchedText: string): boolean => {
	if (!HEADER_CONSTANT_RE.test(lineText)) return false;
	return (
		matchedText.toLowerCase() === "token" ||
		matchedText.toLowerCase() === "bearer" ||
		matchedText === "Authorization" ||
		matchedText.startsWith("X-")
	);
};

const isFixtureSecret = (relativePath: string, lineText: string, matchedText: string): boolean => {
	if (MASKED_SECRET_RE.test(matchedText)) return true;
	if (/(?:mmtest|sample|testing)/i.test(matchedText)) return true;
	if (/updated .*(?:client)?secret/i.test(matchedText)) return true;
	if (!NON_PRODUCTION_SECRET_PATH_RE.test(relativePath) && !FIXTURE_LINE_RE.test(lineText)) {
		return false;
	}
	if (FIXTURE_VALUE_RE.test(matchedText)) return true;
	if (isPlaceholderCredentialUrl(matchedText)) return true;
	return /(?:localhost|mattermost_test|_test|sample|test)/i.test(matchedText);
};

const shouldSkipSecretFinding = (
	relativePath: string,
	name: string,
	lineText: string,
	matchedText: string,
): boolean => {
	if (name === "API key" && PUBLIC_POSTHOG_PROJECT_TOKEN_RE.test(matchedText)) return true;
	if (
		name === "Database connection string with credentials" &&
		isLocalhostExampleDatabaseUrl(matchedText)
	) {
		return true;
	}
	if (GENERATED_SECRET_RE.test(lineText) || GENERATED_SECRET_RE.test(matchedText)) return true;
	if (isHeaderNameConstant(lineText, matchedText)) return true;
	if (isFixtureSecret(relativePath, lineText, matchedText)) return true;
	if (
		(name === "Hardcoded password/secret" || name === "Authentication token") &&
		isSymbolicConstantValue(matchedText)
	) {
		return true;
	}
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

		const relativePath = relativePosix(context.rootDirectory, filePath);

		for (const { pattern, name, keywordPrefixed } of SECRET_PATTERNS) {
			const regex = new RegExp(pattern.source, pattern.flags);

			for (const match of content.matchAll(regex)) {
				const matchedText = match[1] ?? match[0];
				const lineText = lineForMatch(content, match.index);
				if (isPlaceholderValue(matchedText)) continue;
				if (shouldSkipSecretFinding(relativePath, name, lineText, matchedText)) continue;
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
