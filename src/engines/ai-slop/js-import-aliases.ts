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

const resolveTsConfigReference = (
	configPath: string,
	referencePath: string,
	rootDirectory: string,
): string | null => {
	const target = path.resolve(path.dirname(configPath), referencePath);
	const candidates = path.extname(target)
		? [target]
		: [`${target}.json`, path.join(target, "tsconfig.json"), target];
	for (const candidate of candidates) {
		const safePath = safeConfigFilePath(candidate, rootDirectory);
		if (safePath) return safePath;
	}
	return null;
};

const collectAliasMatchersFromConfig = (
	configPath: string,
	matchers: AliasMatcher[],
	visited: Set<string>,
	rootDirectory: string,
	depth = 0,
): void => {
	if (depth > MAX_TS_CONFIG_DEPTH || visited.size >= MAX_TS_CONFIG_FILES) return;
	const resolvedConfigPath = safeConfigFilePath(configPath, rootDirectory);
	if (!resolvedConfigPath) return;
	if (visited.has(resolvedConfigPath)) return;
	visited.add(resolvedConfigPath);

	const config = readJsoncFile(resolvedConfigPath) as Record<string, unknown> | null;
	if (!config) return;
	const opts = config.compilerOptions;
	const configDir = path.dirname(resolvedConfigPath);
	if (opts && typeof opts === "object") {
		const baseUrl = (opts as Record<string, unknown>).baseUrl;
		const configuredBaseDirectory =
			typeof baseUrl === "string"
				? safeProjectDirectoryPath(path.resolve(configDir, baseUrl), rootDirectory)
				: configDir;
		const paths = (opts as Record<string, unknown>).paths;
		if (configuredBaseDirectory && paths && typeof paths === "object") {
			for (const [key, value] of Object.entries(paths as Record<string, unknown>)) {
				if (
					Array.isArray(value) &&
					value.some(
						(target) =>
							typeof target === "string" &&
							isRootBoundedTarget(
								path.resolve(configuredBaseDirectory, target.replaceAll("*", "__aislop__")),
								rootDirectory,
							),
					)
				) {
					matchers.push(buildAliasMatcher(key, configDir));
				}
			}
		}

		if (typeof baseUrl === "string") {
			const baseDir = safeProjectDirectoryPath(path.resolve(configDir, baseUrl), rootDirectory);
			if (baseDir) {
				matchers.push((spec, filePath) => {
					if (!isFileInScope(filePath, configDir)) return false;
					if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@")) return false;
					return JS_RESOLUTION_EXTENSIONS.some((suffix) =>
						safeResolutionEntryExists(path.resolve(baseDir, `${spec}${suffix}`), rootDirectory),
					);
				});
			}
		}
	}

	if (Array.isArray(config.references)) {
		for (const reference of config.references) {
			if (!reference || typeof reference !== "object") continue;
			const referencePath = (reference as Record<string, unknown>).path;
			if (typeof referencePath !== "string") continue;
			const referencedConfig = resolveTsConfigReference(
				resolvedConfigPath,
				referencePath,
				rootDirectory,
			);
			if (referencedConfig) {
				collectAliasMatchersFromConfig(
					referencedConfig,
					matchers,
					visited,
					rootDirectory,
					depth + 1,
				);
			}
		}
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
