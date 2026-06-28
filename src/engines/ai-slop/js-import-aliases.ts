import fs from "node:fs";
import path from "node:path";
import { readJsoncFile } from "../../utils/read-jsonc.js";

export type AliasMatcher = (spec: string) => boolean;

const TS_CONFIG_FILES = ["tsconfig.json", "jsconfig.json"];
const VITE_ALIAS_FILES = [
	"vite.config.ts",
	"vite.config.js",
	"vite.config.mts",
	"vite.config.mjs",
	"vite.config.cts",
	"vite.config.cjs",
	"vite.shared.ts",
	"vite.shared.js",
];
const JS_RESOLUTION_EXTENSIONS = [
	"",
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
	"/index.ts",
	"/index.tsx",
	"/index.js",
	"/index.jsx",
];

const buildAliasMatcher = (key: string): AliasMatcher => {
	const starIdx = key.indexOf("*");
	if (starIdx === -1) {
		return (spec) => spec === key;
	}
	const before = key.slice(0, starIdx);
	const after = key.slice(starIdx + 1);
	return (spec) =>
		spec.length >= before.length + after.length && spec.startsWith(before) && spec.endsWith(after);
};

const buildViteAliasMatcher = (key: string): AliasMatcher => {
	if (key.includes("*")) return buildAliasMatcher(key);
	const prefix = key.endsWith("/") ? key : `${key}/`;
	return (spec) => spec === key || spec.startsWith(prefix);
};

const collectAliasMatchersFromConfig = (configPath: string, matchers: AliasMatcher[]): void => {
	const config = readJsoncFile(configPath) as Record<string, unknown> | null;
	const opts = config?.compilerOptions;
	if (!opts || typeof opts !== "object") return;
	const configDir = path.dirname(configPath);
	const paths = (opts as Record<string, unknown>).paths;
	if (paths && typeof paths === "object") {
		for (const key of Object.keys(paths as Record<string, unknown>)) {
			matchers.push(buildAliasMatcher(key));
		}
	}

	const baseUrl = (opts as Record<string, unknown>).baseUrl;
	if (typeof baseUrl === "string") {
		const baseDir = path.resolve(configDir, baseUrl);
		matchers.push((spec) => {
			if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@")) return false;
			return JS_RESOLUTION_EXTENSIONS.some((suffix) =>
				fs.existsSync(path.join(baseDir, `${spec}${suffix}`)),
			);
		});
	}
};

const findBalancedBlock = (content: string, openIndex: number): string | null => {
	const open = content[openIndex];
	const close = open === "{" ? "}" : open === "[" ? "]" : null;
	if (!close) return null;
	let depth = 0;
	let quote: string | null = null;
	let escaped = false;
	for (let i = openIndex; i < content.length; i++) {
		const ch = content[i];
		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === quote) {
				quote = null;
			}
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			continue;
		}
		if (ch === open) depth++;
		if (ch === close) depth--;
		if (depth === 0) return content.slice(openIndex, i + 1);
	}
	return null;
};

const isLocalAliasReplacement = (rawValue: string): boolean => {
	const value = rawValue.trim();
	if (/\bpath\.resolve\s*\(/.test(value)) return true;
	if (/\bfileURLToPath\s*\(\s*new\s+URL\s*\(\s*["']\.{1,2}\//.test(value)) return true;
	if (/\bnew\s+URL\s*\(\s*["']\.{1,2}\//.test(value)) return true;
	const literal = /^["']([^"']+)["']/.exec(value);
	if (!literal) return false;
	const target = literal[1];
	return (
		target.startsWith(".") ||
		target.startsWith("/") ||
		target.startsWith("~/") ||
		target.startsWith("@/")
	);
};

const OBJECT_ALIAS_ENTRY_RE =
	/(?:^|[,{\n]\s*)(?:(["'])([^"']+)\1|([A-Za-z_$][\w$-]*))\s*:\s*([^,\n}]+)/g;

const collectViteObjectAliases = (block: string, matchers: AliasMatcher[]): void => {
	for (const match of block.matchAll(OBJECT_ALIAS_ENTRY_RE)) {
		const key = match[2] ?? match[3];
		const value = match[4];
		if (!key || !value || !isLocalAliasReplacement(value)) continue;
		matchers.push(buildViteAliasMatcher(key));
	}
};

const ARRAY_ALIAS_ENTRY_RE =
	/\{\s*find\s*:\s*(["'])([^"']+)\1[\s\S]*?replacement\s*:\s*([^,\n}]+)[\s\S]*?\}/g;

const collectViteArrayAliases = (block: string, matchers: AliasMatcher[]): void => {
	for (const match of block.matchAll(ARRAY_ALIAS_ENTRY_RE)) {
		const key = match[2];
		const value = match[3];
		if (!key || !value || !isLocalAliasReplacement(value)) continue;
		matchers.push(buildViteAliasMatcher(key));
	}
};

const collectViteAliasesFromConfig = (configPath: string, matchers: AliasMatcher[]): void => {
	let content: string;
	try {
		content = fs.readFileSync(configPath, "utf-8");
	} catch {
		return;
	}

	const aliasStartRe = /\b(?:alias|aliases)\s*[:=]\s*(?:\x7b|\[)/g;
	for (const match of content.matchAll(aliasStartRe)) {
		const openIndex = match.index + match[0].length - 1;
		const block = findBalancedBlock(content, openIndex);
		if (!block) continue;
		if (block.charCodeAt(0) === 123) {
			collectViteObjectAliases(block, matchers);
		} else {
			collectViteArrayAliases(block, matchers);
		}
	}
};

const PACKAGE_ROOT_SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"out",
	"target",
	"coverage",
]);

const collectNestedPackageRootDirs = (rootDir: string): string[] => {
	const roots = new Set<string>();
	const walk = (dir: string, depth: number): void => {
		if (depth > 4) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".") && entry.name !== ".github") continue;
			if (PACKAGE_ROOT_SKIP_DIRS.has(entry.name)) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full, depth + 1);
			} else if (entry.name === "package.json" && depth > 0) {
				roots.add(dir);
			}
		}
	};
	walk(rootDir, 0);
	return [...roots];
};

const collectPackageRootDirs = (rootDir: string, workspaceDirs: string[]): string[] => {
	const roots = new Set<string>([
		rootDir,
		...workspaceDirs,
		...collectNestedPackageRootDirs(rootDir),
	]);
	return [...roots];
};

const collectPackageJsonImportMatchers = (pkgPath: string, matchers: AliasMatcher[]): void => {
	const pkg = readJsoncFile(pkgPath) as Record<string, unknown> | null;
	if (!pkg || typeof pkg !== "object") return;
	const imports = pkg.imports;
	if (!imports || typeof imports !== "object") return;
	for (const key of Object.keys(imports as Record<string, unknown>)) {
		matchers.push(buildAliasMatcher(key));
	}
};

export const collectTsPathAliases = (rootDir: string, workspaceDirs: string[]): AliasMatcher[] => {
	const matchers: AliasMatcher[] = [];
	const dirs = collectPackageRootDirs(rootDir, workspaceDirs);
	for (const dir of dirs) {
		for (const fname of TS_CONFIG_FILES) {
			collectAliasMatchersFromConfig(path.join(dir, fname), matchers);
		}
		for (const fname of VITE_ALIAS_FILES) {
			collectViteAliasesFromConfig(path.join(dir, fname), matchers);
		}
		collectPackageJsonImportMatchers(path.join(dir, "package.json"), matchers);
	}
	return matchers;
};
