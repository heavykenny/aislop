import fs from "node:fs";
import path from "node:path";
import { safeProjectFilePath } from "../../utils/project-path-safety.js";
import { readJsoncFile } from "../../utils/read-jsonc.js";
import { type AliasMatcher, buildAliasMatcher } from "./js-alias-matcher.js";
import { hasValidPackageImportTarget } from "./js-import-alias-targets.js";

const PACKAGE_ROOT_SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"out",
	"target",
	"coverage",
]);

const collectNestedPackageRootDirs = (rootDirectory: string): string[] => {
	const roots = new Set<string>();
	const walk = (directory: string, depth: number): void => {
		if (depth > 4) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".") && entry.name !== ".github") continue;
			if (PACKAGE_ROOT_SKIP_DIRS.has(entry.name)) continue;
			const fullPath = path.join(directory, entry.name);
			if (entry.isDirectory()) walk(fullPath, depth + 1);
			else if (entry.name === "package.json" && depth > 0) roots.add(directory);
		}
	};
	walk(rootDirectory, 0);
	return [...roots];
};

export const collectPackageRootDirs = (
	rootDirectory: string,
	workspaceDirectories: string[],
): string[] => [
	...new Set([
		rootDirectory,
		...workspaceDirectories,
		...collectNestedPackageRootDirs(rootDirectory),
	]),
];

export const collectPackageJsonImportMatchers = (
	packagePath: string,
	matchers: AliasMatcher[],
	rootDirectory: string,
): void => {
	const safePath = safeProjectFilePath(packagePath, rootDirectory);
	if (!safePath) return;
	const pkg = readJsoncFile(safePath) as Record<string, unknown> | null;
	if (!pkg || typeof pkg !== "object") return;
	const imports = pkg.imports;
	if (!imports || typeof imports !== "object") return;
	const packageDirectory = path.dirname(safePath);
	for (const [key, value] of Object.entries(imports as Record<string, unknown>)) {
		if (key === "#" || key.startsWith("#/") || !key.startsWith("#")) continue;
		if (!hasValidPackageImportTarget(value, packageDirectory, rootDirectory)) continue;
		matchers.push(buildAliasMatcher(key, packageDirectory));
	}
};
