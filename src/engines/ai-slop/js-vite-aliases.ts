import fs from "node:fs";
import path from "node:path";
import { safeProjectFilePath } from "../../utils/project-path-safety.js";
import { maskComments, maskStringsAndComments } from "../../utils/source-masker.js";
import { type AliasMatcher, buildPrefixAliasMatcher } from "./js-alias-matcher.js";
import { isLocalAliasReplacement } from "./js-import-alias-targets.js";

export const VITE_ALIAS_FILES = [
	"vite.config.ts",
	"vite.config.js",
	"vite.config.mts",
	"vite.config.mjs",
	"vite.config.cts",
	"vite.config.cjs",
	"vite.shared.ts",
	"vite.shared.js",
];

const findBalancedBlock = (content: string, openIndex: number): string | null => {
	const open = content[openIndex];
	const close = open === "{" ? "}" : open === "[" ? "]" : null;
	if (!close) return null;
	let depth = 0;
	let quote: string | null = null;
	let escaped = false;
	for (let index = openIndex; index < content.length; index++) {
		const character = content[index];
		if (quote) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'" || character === "`") {
			quote = character;
			continue;
		}
		if (character === open) depth++;
		if (character === close) depth--;
		if (depth === 0) return content.slice(openIndex, index + 1);
	}
	return null;
};

const OBJECT_ALIAS_ENTRY_RE =
	/(?:^|[,{\n]\s*)(?:(["'])([^"']+)\1|([A-Za-z_$][\w$-]*))\s*:\s*(path\.resolve\s*\((?:process\.cwd\(\)|[^)])*\)|fileURLToPath\s*\(\s*new\s+URL\s*\([^)]*\)\s*\)|new\s+URL\s*\([^)]*\)|["'][^"']+["'])/g;
const ARRAY_ALIAS_ENTRY_RE =
	/\{\s*find\s*:\s*(["'])([^"']+)\1[\s\S]*?replacement\s*:\s*(path\.resolve\s*\((?:process\.cwd\(\)|[^)])*\)|fileURLToPath\s*\(\s*new\s+URL\s*\([^)]*\)\s*\)|new\s+URL\s*\([^)]*\)|["'][^"']+["'])[\s\S]*?\}/g;

const collectAliases = (
	block: string,
	pattern: RegExp,
	matchers: AliasMatcher[],
	configDirectory: string,
	rootDirectory: string,
): void => {
	for (const match of block.matchAll(pattern)) {
		const key = pattern === OBJECT_ALIAS_ENTRY_RE ? (match[2] ?? match[3]) : match[2];
		const value = pattern === OBJECT_ALIAS_ENTRY_RE ? match[4] : match[3];
		if (!key || !value || !isLocalAliasReplacement(value, configDirectory, rootDirectory)) continue;
		matchers.push(buildPrefixAliasMatcher(key, configDirectory));
	}
};

export const collectViteAliasesFromConfig = (
	configPath: string,
	matchers: AliasMatcher[],
	rootDirectory: string,
): void => {
	const safePath = safeProjectFilePath(configPath, rootDirectory);
	if (!safePath) return;
	let content: string;
	try {
		content = fs.readFileSync(safePath, "utf-8");
	} catch {
		return;
	}

	const aliasStartPattern = /\b(?:alias|aliases)\s*[:=]\s*(?:\x7b|\[)/g;
	const configDirectory = path.dirname(safePath);
	const extension = path.extname(safePath).toLowerCase();
	const commentMasked = maskComments(content, extension);
	const fullyMasked = maskStringsAndComments(content, extension);
	for (const match of commentMasked.matchAll(aliasStartPattern)) {
		const keywordOffset = match[0].search(/\b(?:alias|aliases)\b/);
		const keywordIndex = match.index + keywordOffset;
		const keyword = /^(?:alias|aliases)/.exec(match[0].slice(keywordOffset))?.[0];
		if (!keyword || fullyMasked.slice(keywordIndex, keywordIndex + keyword.length) !== keyword) {
			continue;
		}
		const openIndex = match.index + match[0].length - 1;
		const maskedBlock = findBalancedBlock(commentMasked, openIndex);
		if (!maskedBlock) continue;
		const block = commentMasked.slice(openIndex, openIndex + maskedBlock.length);
		const pattern = block.charCodeAt(0) === 123 ? OBJECT_ALIAS_ENTRY_RE : ARRAY_ALIAS_ENTRY_RE;
		collectAliases(block, pattern, matchers, configDirectory, rootDirectory);
	}
};
