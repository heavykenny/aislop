import fs from "node:fs";
import path from "node:path";

export type AliasMatcher = (specifier: string, filePath?: string) => boolean;

const canonicalPath = (filePath: string): string => {
	try {
		return fs.realpathSync(filePath);
	} catch {
		return path.resolve(filePath);
	}
};

export const isFileInScope = (filePath: string | undefined, scopeDirectory: string): boolean => {
	if (!filePath) return true;
	const candidate = canonicalPath(filePath);
	const relative = path.relative(scopeDirectory, candidate);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export const buildAliasMatcher = (key: string, scopeDirectory: string): AliasMatcher => {
	const starIndex = key.indexOf("*");
	if (starIndex === -1) {
		return (specifier, filePath) => isFileInScope(filePath, scopeDirectory) && specifier === key;
	}
	const before = key.slice(0, starIndex);
	const after = key.slice(starIndex + 1);
	return (specifier, filePath) =>
		isFileInScope(filePath, scopeDirectory) &&
		specifier.length >= before.length + after.length &&
		specifier.startsWith(before) &&
		specifier.endsWith(after);
};

export const buildPrefixAliasMatcher = (key: string, scopeDirectory: string): AliasMatcher => {
	if (key.includes("*")) return buildAliasMatcher(key, scopeDirectory);
	const prefix = key.endsWith("/") ? key : `${key}/`;
	return (specifier, filePath) =>
		isFileInScope(filePath, scopeDirectory) && (specifier === key || specifier.startsWith(prefix));
};
