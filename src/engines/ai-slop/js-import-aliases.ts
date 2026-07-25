import fs from "node:fs";
import path from "node:path";
import {
	isRootBoundedTarget,
	safeProjectDirectoryPath,
	safeProjectFilePath,
} from "../../utils/project-path-safety.js";
import { readJsoncFile } from "../../utils/read-jsonc.js";
import { type AliasMatcher, buildAliasMatcher, isFileInScope } from "./js-alias-matcher.js";
import { collectPackageJsonImportMatchers, collectPackageRootDirs } from "./js-package-imports.js";
import { collectViteAliasesFromConfig, VITE_ALIAS_FILES } from "./js-vite-aliases.js";

export type { AliasMatcher } from "./js-alias-matcher.js";

const TS_CONFIG_FILES = ["tsconfig.json", "jsconfig.json"];
const JS_RESOLUTION_EXTENSIONS = [
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
const MAX_TS_CONFIG_DEPTH = 16;
const MAX_TS_CONFIG_FILES = 128;

const safeConfigFilePath = (candidate: string, rootDirectory: string): string | null => {
	return safeProjectFilePath(candidate, rootDirectory);
};

const safeResolutionEntryExists = (candidate: string, rootDirectory: string): boolean => {
	try {
		const absolutePath = path.resolve(candidate);
		const lexicalRelative = path.relative(rootDirectory, absolutePath);
		if (lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative)) return false;
		const stats = fs.lstatSync(absolutePath);
		if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) return false;
		const realPath = fs.realpathSync(absolutePath);
		const relative = path.relative(rootDirectory, realPath);
		return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
	} catch {
		return false;
	}
};

const resolveTsConfigExtends = (
	configPath: string,
	extendsPath: string,
	rootDirectory: string,
): string | null => {
	const target = path.resolve(path.dirname(configPath), extendsPath);
	const candidates = path.extname(target) === ".json" ? [target] : [target, `${target}.json`];
	for (const candidate of candidates) {
		const safePath = safeConfigFilePath(candidate, rootDirectory);
		if (safePath) return safePath;
	}
	return null;
};

type TsConfigEntry = {
	readonly configPath: string;
	readonly config: Record<string, unknown>;
};

const readTsConfigChain = (
	configPath: string,
	rootDirectory: string,
	chain: Set<string>,
	depth = 0,
): TsConfigEntry[] => {
	if (depth > MAX_TS_CONFIG_DEPTH || chain.size >= MAX_TS_CONFIG_FILES) return [];
	const resolvedConfigPath = safeConfigFilePath(configPath, rootDirectory);
	if (!resolvedConfigPath || chain.has(resolvedConfigPath)) return [];
	chain.add(resolvedConfigPath);

	const config = readJsoncFile(resolvedConfigPath) as Record<string, unknown> | null;
	if (!config) return [];

	const extendsValue = config.extends;
	const extendsPaths =
		typeof extendsValue === "string"
			? [extendsValue]
			: Array.isArray(extendsValue)
				? extendsValue.filter((value): value is string => typeof value === "string")
				: [];
	const parents: TsConfigEntry[] = [];
	for (const extendsPath of extendsPaths) {
		const parentPath = resolveTsConfigExtends(resolvedConfigPath, extendsPath, rootDirectory);
		if (!parentPath) continue;
		parents.push(...readTsConfigChain(parentPath, rootDirectory, chain, depth + 1));
	}
	return [...parents, { configPath: resolvedConfigPath, config }];
};

type TsConfigOption = {
	readonly configPath: string;
	readonly value: unknown;
};

const collectAliasMatchersFromConfig = (
	configPath: string,
	matchers: AliasMatcher[],
	visited: Set<string>,
	rootDirectory: string,
): void => {
	const resolvedConfigPath = safeConfigFilePath(configPath, rootDirectory);
	if (!resolvedConfigPath) return;
	const configScope = path.dirname(resolvedConfigPath);
	const visitKey = `${resolvedConfigPath}\0${configScope}`;
	if (visited.has(visitKey)) return;
	visited.add(visitKey);

	const chain = readTsConfigChain(resolvedConfigPath, rootDirectory, new Set<string>());
	let pathsOption: TsConfigOption | undefined;
	let baseUrlOption: TsConfigOption | undefined;
	for (const entry of chain) {
		const opts = entry.config.compilerOptions;
		if (!opts || typeof opts !== "object") continue;
		const compilerOptions = opts as Record<string, unknown>;
		if (Object.hasOwn(compilerOptions, "paths")) {
			pathsOption = { configPath: entry.configPath, value: compilerOptions.paths };
		}
		if (Object.hasOwn(compilerOptions, "baseUrl")) {
			baseUrlOption = { configPath: entry.configPath, value: compilerOptions.baseUrl };
		}
	}

	const baseDir =
		baseUrlOption && typeof baseUrlOption.value === "string"
			? safeProjectDirectoryPath(
					path.resolve(path.dirname(baseUrlOption.configPath), baseUrlOption.value),
					rootDirectory,
				)
			: null;
	const pathsBaseDirectory = baseDir ?? (pathsOption ? path.dirname(pathsOption.configPath) : null);
	const paths = pathsOption?.value;
	if (pathsBaseDirectory && paths && typeof paths === "object") {
		for (const [key, value] of Object.entries(paths as Record<string, unknown>)) {
			if (
				Array.isArray(value) &&
				value.some(
					(target) =>
						typeof target === "string" &&
						isRootBoundedTarget(
							path.resolve(pathsBaseDirectory, target.replaceAll("*", "__aislop__")),
							rootDirectory,
						),
				)
			) {
				matchers.push(buildAliasMatcher(key, configScope));
			}
		}
	}

	if (baseDir) {
		matchers.push((spec, filePath) => {
			if (!isFileInScope(filePath, configScope)) return false;
			if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@")) return false;
			return JS_RESOLUTION_EXTENSIONS.some((suffix) =>
				safeResolutionEntryExists(path.resolve(baseDir, `${spec}${suffix}`), rootDirectory),
			);
		});
	}
};

export const collectTsPathAliases = (rootDir: string, workspaceDirs: string[]): AliasMatcher[] => {
	const matchers: AliasMatcher[] = [];
	const visited = new Set<string>();
	let rootDirectory: string;
	try {
		rootDirectory = fs.realpathSync(rootDir);
	} catch {
		return matchers;
	}
	const dirs = collectPackageRootDirs(rootDirectory, workspaceDirs);
	for (const dir of dirs) {
		for (const fname of TS_CONFIG_FILES) {
			collectAliasMatchersFromConfig(path.join(dir, fname), matchers, visited, rootDirectory);
		}
		for (const fname of VITE_ALIAS_FILES) {
			collectViteAliasesFromConfig(path.join(dir, fname), matchers, rootDirectory);
		}
		collectPackageJsonImportMatchers(path.join(dir, "package.json"), matchers, rootDirectory);
	}
	return matchers;
};
