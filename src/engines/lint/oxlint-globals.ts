import fs from "node:fs";
import path from "node:path";
import { listProjectFiles } from "../../utils/source-files.js";

const OPEN_BRACE = String.fromCharCode(123);
const CLOSE_BRACE = String.fromCharCode(125);
const OPEN_BRACKET = String.fromCharCode(91);
const CLOSE_BRACKET = String.fromCharCode(93);

const readTextFile = (filePath: string): string | null => {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
};

const collectPackageNames = (dir: string): Set<string> => {
	const names = new Set<string>();
	const raw = readTextFile(path.join(dir, "package.json"));
	if (!raw) return names;

	try {
		const pkg = JSON.parse(raw) as Record<string, Record<string, string> | string>;
		for (const section of [
			"dependencies",
			"devDependencies",
			"peerDependencies",
			"optionalDependencies",
		]) {
			const deps = pkg[section];
			if (deps && typeof deps === "object") {
				for (const name of Object.keys(deps)) names.add(name);
			}
		}
	} catch {
		return names;
	}

	return names;
};

const readJson = (filePath: string): Record<string, unknown> | null => {
	const raw = readTextFile(filePath);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
};

const ESLINT_CONFIG_RE =
	/(?:^|\/)(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\.(?:json|[cm]?[jt]s))?)$/;
const ESLINT_GLOBALS_PROPERTY_RE = /(?:\bglobals|["']globals["'])\s*:/g;
const ESLINT_IGNORES_PROPERTY_RE =
	/(?:\bignores|\bignorePatterns|["']ignores["']|["']ignorePatterns["'])\s*:/g;
const IDENTIFIER_GLOBAL_RE = /(?:^|,\s*)([A-Za-z_$][\w$]*)\s*:/g;
const QUOTED_GLOBAL_KEY_RE = /["']([A-Za-z_$][\w$]*)["']\s*:/g;
const STRING_LITERAL_RE = /["']([^"']+)["']/g;
const ESLINT_GLOBAL_PACKAGE_MEMBERS: Record<string, string[]> = {
	jquery: ["$", "jQuery"],
	jest: [
		"describe",
		"it",
		"expect",
		"test",
		"beforeAll",
		"afterAll",
		"beforeEach",
		"afterEach",
		"jest",
	],
	mocha: ["describe", "it", "before", "after", "beforeEach", "afterEach"],
};

const stripJsComments = (value: string): string =>
	value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const readBalancedBlock = (
	source: string,
	openIndex: number,
	openToken: string,
	closeToken: string,
): string | null => {
	let depth = 0;
	let quote: string | null = null;
	let escaped = false;

	for (let index = openIndex; index < source.length; index++) {
		const char = source[index];
		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === quote) {
				quote = null;
			}
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			quote = char;
			continue;
		}
		if (char === openToken) {
			depth++;
		} else if (char === closeToken) {
			depth--;
			if (depth === 0) return source.slice(openIndex + 1, index);
		}
	}

	return null;
};

const readBalancedObject = (source: string, openBraceIndex: number): string | null =>
	readBalancedBlock(source, openBraceIndex, OPEN_BRACE, CLOSE_BRACE);

const readBalancedArray = (source: string, openBracketIndex: number): string | null =>
	readBalancedBlock(source, openBracketIndex, OPEN_BRACKET, CLOSE_BRACKET);

const extractGlobalsObjectBlocks = (source: string): string[] => {
	const blocks: string[] = [];
	for (const match of source.matchAll(ESLINT_GLOBALS_PROPERTY_RE)) {
		const openBraceIndex = source.indexOf(OPEN_BRACE, (match.index ?? 0) + match[0].length);
		if (openBraceIndex === -1) continue;
		const block = readBalancedObject(source, openBraceIndex);
		if (block) blocks.push(block);
	}
	return blocks;
};

const extractIgnoreArrayBlocks = (source: string): string[] => {
	const blocks: string[] = [];
	for (const match of source.matchAll(ESLINT_IGNORES_PROPERTY_RE)) {
		const openBracketIndex = source.indexOf(OPEN_BRACKET, (match.index ?? 0) + match[0].length);
		if (openBracketIndex === -1) continue;
		const block = readBalancedArray(source, openBracketIndex);
		if (block) blocks.push(block);
	}
	return blocks;
};

const collectGlobalsFromEslintConfig = (content: string): string[] => {
	const globals = new Set<string>();
	const stripped = stripJsComments(content);

	for (const block of extractGlobalsObjectBlocks(stripped)) {
		for (const spread of block.matchAll(/\.\.\.\s*globals\.([A-Za-z_$][\w$]*)/g)) {
			for (const name of ESLINT_GLOBAL_PACKAGE_MEMBERS[spread[1]] ?? []) {
				globals.add(name);
			}
		}
		for (const quoted of block.matchAll(QUOTED_GLOBAL_KEY_RE)) {
			globals.add(quoted[1]);
		}
		for (const identifier of block.matchAll(IDENTIFIER_GLOBAL_RE)) {
			if (identifier[1] !== "globals") globals.add(identifier[1]);
		}
	}

	return [...globals];
};

const collectIgnoresFromEslintConfig = (content: string): string[] => {
	const ignores = new Set<string>();
	const stripped = stripJsComments(content);

	for (const block of extractIgnoreArrayBlocks(stripped)) {
		for (const literal of block.matchAll(STRING_LITERAL_RE)) {
			if (!literal[1].startsWith("!")) ignores.add(literal[1]);
		}
	}

	return [...ignores];
};

const collectEslintGlobals = (rootDir: string, projectFiles: string[]): string[] => {
	const globals = new Set<string>();

	for (const relativePath of projectFiles) {
		const normalized = relativePath.split(path.sep).join("/");
		if (!ESLINT_CONFIG_RE.test(normalized)) continue;
		const content = readTextFile(path.join(rootDir, relativePath));
		if (!content) continue;
		for (const name of collectGlobalsFromEslintConfig(content)) {
			globals.add(name);
		}
	}

	return [...globals];
};

export const collectEslintIgnorePatterns = (rootDir: string): string[] => {
	const ignores = new Set<string>();
	const projectFiles = listProjectFiles(rootDir);

	for (const relativePath of projectFiles) {
		const normalized = relativePath.split(path.sep).join("/");
		if (!ESLINT_CONFIG_RE.test(normalized)) continue;
		const content = readTextFile(path.join(rootDir, relativePath));
		if (!content) continue;
		for (const pattern of collectIgnoresFromEslintConfig(content)) {
			ignores.add(pattern);
		}
	}

	return [...ignores];
};

const hasBunRuntime = (rootDir: string, projectFiles: string[]): boolean => {
	if (
		fs.existsSync(path.join(rootDir, "bun.lock")) ||
		fs.existsSync(path.join(rootDir, "bun.lockb")) ||
		fs.existsSync(path.join(rootDir, "bunfig.toml"))
	) {
		return true;
	}
	const hasBunFiles = projectFiles.some((filePath) =>
		/(?:^|\/)bunfig\.toml$|(?:^|\/)bun\.lockb?$/.test(filePath),
	);

	const pkg = readJson(path.join(rootDir, "package.json"));
	if (!pkg) return hasBunFiles;
	if (typeof pkg.packageManager === "string" && /^bun@/i.test(pkg.packageManager)) return true;

	const scripts = pkg.scripts;
	if (scripts && typeof scripts === "object") {
		for (const command of Object.values(scripts as Record<string, unknown>)) {
			if (typeof command === "string" && /(?:^|[;&|()\s])bunx?\s/.test(command)) return true;
		}
	}

	return hasBunFiles;
};

const hasDenoRuntime = (rootDir: string, projectFiles: string[]): boolean => {
	if (
		fs.existsSync(path.join(rootDir, "deno.json")) ||
		fs.existsSync(path.join(rootDir, "deno.jsonc"))
	) {
		return true;
	}
	return projectFiles.some((filePath) => /(?:^|\/)deno\.jsonc?$/.test(filePath));
};

const AMBIENT_GLOBAL_RE =
	/^\s*(?:declare\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

export const collectAmbientGlobals = (rootDir: string): string[] => {
	const globals = new Set<string>();
	const projectFiles = listProjectFiles(rootDir);

	for (const relativePath of projectFiles) {
		if (!relativePath.endsWith(".d.ts")) continue;
		const content = readTextFile(path.join(rootDir, relativePath));
		if (!content) continue;

		for (const match of content.matchAll(AMBIENT_GLOBAL_RE)) {
			globals.add(match[1]);
		}
	}

	const deps = collectPackageNames(rootDir);
	if (deps.has("@types/bun") || deps.has("bun-types") || hasBunRuntime(rootDir, projectFiles)) {
		globals.add("Bun");
	}
	if (hasDenoRuntime(rootDir, projectFiles)) globals.add("Deno");

	for (const name of collectEslintGlobals(rootDir, projectFiles)) {
		globals.add(name);
	}

	if (projectFiles.some((filePath) => /(?:^|\/)sst\.config\.ts$/.test(filePath))) {
		for (const name of [
			"$app",
			"$config",
			"$dev",
			"$interpolate",
			"$resolve",
			"$jsonParse",
			"$jsonStringify",
			"aws",
			"cloudflare",
			"docker",
			"random",
			"sst",
			"vercel",
			"pulumi",
		]) {
			globals.add(name);
		}
	}

	return [...globals];
};
