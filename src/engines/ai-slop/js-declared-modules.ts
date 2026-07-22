import fs from "node:fs";
import path from "node:path";
import { safeProjectFilePath } from "../../utils/project-path-safety.js";
import { readJsoncFile } from "../../utils/read-jsonc.js";
import { maskComments, maskStringsAndComments } from "../../utils/source-masker.js";
import { readJson } from "./hallucinated-imports-manifest.js";
import { type AliasMatcher, isFileInScope } from "./js-alias-matcher.js";

const AMBIENT_MODULE_RE = /^\s*declare\s+module\s+(["'])([^"']+)\1/gm;
const CONFIG_FILES = new Set(["tsconfig.json", "jsconfig.json"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage"]);
const MAX_NESTED_EXPORT_DEPTH = 32;
const MAX_NESTED_EXPORT_NODES = 1024;

const isExternalModuleDeclaration = (content: string): boolean => {
	const maskedContent = maskStringsAndComments(content, ".ts");
	let braceDepth = 0;
	let cursor = 0;
	for (const token of maskedContent.matchAll(/\b(?:import|export)\b/g)) {
		const tokenIndex = token.index;
		for (let index = cursor; index < tokenIndex; index++) {
			const character = maskedContent[index];
			if (character === "{") braceDepth++;
			if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
		}
		const nextCharacter = maskedContent.slice(tokenIndex + token[0].length).trimStart()[0];
		if (braceDepth === 0 && (token[0] === "export" || nextCharacter !== "(")) return true;
		cursor = tokenIndex + token[0].length;
	}
	return false;
};

const declarationScope = (filePath: string, rootDirectory: string): string => {
	const root = fs.realpathSync(rootDirectory);
	let directory = path.dirname(fs.realpathSync(filePath));
	while (directory === root || directory.startsWith(`${root}${path.sep}`)) {
		const pkg = readJson(path.join(directory, "package.json"), root);
		if (pkg && typeof pkg === "object") return directory;
		if (directory === root) break;
		directory = path.dirname(directory);
	}
	return root;
};

const nestedStringValues = (value: unknown): string[] => {
	const values: string[] = [];
	const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
	let visitedNodes = 0;
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) break;
		visitedNodes++;
		if (visitedNodes > MAX_NESTED_EXPORT_NODES || current.depth > MAX_NESTED_EXPORT_DEPTH) {
			return [];
		}
		if (typeof current.value === "string") {
			values.push(current.value);
			continue;
		}
		if (!current.value || typeof current.value !== "object") continue;
		const children = Array.isArray(current.value)
			? current.value
			: Object.values(current.value as Record<string, unknown>);
		for (const child of children) {
			pending.push({ value: child, depth: current.depth + 1 });
		}
	}
	return values;
};

const declarationTypeReferences = (
	filePath: string,
	packageDirectory: string,
	rootDirectory: string,
): Set<string> => {
	const references = new Set<string>();
	const pkg = readJson(path.join(packageDirectory, "package.json"), rootDirectory) as Record<
		string,
		unknown
	> | null;
	if (!pkg || typeof pkg.name !== "string") return references;
	if (typeof pkg.types === "string") {
		const typesPath = safeProjectFilePath(path.resolve(packageDirectory, pkg.types), rootDirectory);
		if (typesPath === filePath) references.add(pkg.name);
	}
	if (!pkg.exports || typeof pkg.exports !== "object") return references;
	for (const [exportKey, value] of Object.entries(pkg.exports as Record<string, unknown>)) {
		if (exportKey !== "." && !exportKey.startsWith("./")) continue;
		const exposesDeclaration = nestedStringValues(value).some(
			(target) =>
				safeProjectFilePath(path.resolve(packageDirectory, target), rootDirectory) === filePath,
		);
		if (exposesDeclaration) {
			references.add(exportKey === "." ? pkg.name : `${pkg.name}${exportKey.slice(1)}`);
		}
	}
	return references;
};

const configFiles = (rootDirectory: string): string[] => {
	const files: string[] = [];
	const walk = (directory: string, depth: number): void => {
		if (depth > 5 || files.length >= 256) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (!entry.isSymbolicLink() && !SKIP_DIRECTORIES.has(entry.name)) {
					walk(path.join(directory, entry.name), depth + 1);
				}
			} else if (CONFIG_FILES.has(entry.name)) {
				const safePath = safeProjectFilePath(path.join(directory, entry.name), rootDirectory);
				if (safePath) files.push(safePath);
			}
		}
	};
	walk(rootDirectory, 0);
	return files;
};

const referencedTypeScopes = (
	references: Set<string>,
	rootDirectory: string,
	configs: string[],
): string[] => {
	if (references.size === 0) return [];
	const scopes: string[] = [];
	for (const configPath of configs) {
		const config = readJsoncFile(configPath) as Record<string, unknown> | null;
		const compilerOptions =
			config?.compilerOptions && typeof config.compilerOptions === "object"
				? (config.compilerOptions as Record<string, unknown>)
				: null;
		if (!compilerOptions || !Array.isArray(compilerOptions.types)) continue;
		if (compilerOptions.types.some((value) => typeof value === "string" && references.has(value))) {
			scopes.push(path.dirname(configPath));
		}
	}
	return scopes.filter((scope) => isFileInScope(scope, rootDirectory));
};

const matcherForDeclaration = (declaration: string, scopeDirectories: string[]): AliasMatcher => {
	const inScope = (filePath: string | undefined): boolean =>
		scopeDirectories.some((scope) => isFileInScope(filePath, scope));
	const starIndex = declaration.indexOf("*");
	if (starIndex === -1) {
		return (specifier, filePath) => inScope(filePath) && specifier === declaration;
	}
	const before = declaration.slice(0, starIndex);
	const after = declaration.slice(starIndex + 1);
	return (specifier, filePath) =>
		inScope(filePath) &&
		specifier.length >= before.length + after.length &&
		specifier.startsWith(before) &&
		specifier.endsWith(after);
};

export const collectDeclaredModuleMatchers = (
	files: string[],
	rootDirectory: string,
): AliasMatcher[] => {
	const matchers: AliasMatcher[] = [];
	const root = fs.realpathSync(rootDirectory);
	const configs = configFiles(root);
	for (const filePath of files) {
		if (!filePath.endsWith(".d.ts")) continue;
		const safePath = safeProjectFilePath(filePath, rootDirectory);
		if (!safePath) continue;
		let content: string;
		try {
			content = fs.readFileSync(safePath, "utf-8");
		} catch {
			continue;
		}
		if (isExternalModuleDeclaration(content)) continue;
		const packageDirectory = declarationScope(safePath, root);
		const references = declarationTypeReferences(safePath, packageDirectory, root);
		const scopeDirectories = [packageDirectory, ...referencedTypeScopes(references, root, configs)];
		for (const match of maskComments(content, ".ts").matchAll(AMBIENT_MODULE_RE)) {
			matchers.push(matcherForDeclaration(match[2], scopeDirectories));
		}
	}
	return matchers;
};
