import path from "node:path";
import micromatch from "micromatch";
import type { Diagnostic } from "../engines/types.js";
import { toPosix } from "./paths.js";

// Expand user-facing exclude entries into micromatch globs. A bare directory
// ("external/VendorLib") becomes "external/VendorLib/**"; a bare extension
// (".cs") becomes "**/*.cs"; anything already glob- or path-shaped is kept verbatim.
// This is the single normalization the file-scanning path and the diagnostic
// post-filter share, so both honor the exclude list identically.
export const normalizeExcludePatterns = (patterns: string[]): string[] => {
	return patterns.flatMap((pattern) => {
		const p = pattern.trim();
		if (p.startsWith(".")) {
			return [`**/*${p}`];
		}
		if (!p.includes("*") && !p.includes(".")) {
			return [`${p}/**`];
		}
		return [p];
	});
};

export const isPathExcluded = (relativePath: string, normalizedPatterns: string[]): boolean => {
	if (normalizedPatterns.length === 0) return false;
	return micromatch.isMatch(relativePath, normalizedPatterns, { dot: true });
};

// Drop diagnostics whose file lies under a user-excluded path. The build-backed
// C# engines (dotnet format, roslynator, jb inspectcode) shell out to tools that
// scan whole projects or solutions and cannot honor aislop's exclude list
// themselves; a root .sln pulls in every member project regardless. Filtering
// their output here - the single place
// every engine's diagnostics pass through - keeps them consistent with the
// file-scanning engines, which already start from the excluded file list.
export const filterExcludedDiagnostics = (
	diagnostics: Diagnostic[],
	rootDirectory: string,
	excludePatterns: string[] | undefined,
): Diagnostic[] => {
	if (!excludePatterns || excludePatterns.length === 0) return diagnostics;
	const normalized = normalizeExcludePatterns(excludePatterns);
	if (normalized.length === 0) return diagnostics;
	return diagnostics.filter((diagnostic) => {
		const relativePath = path.isAbsolute(diagnostic.filePath)
			? toPosix(path.relative(rootDirectory, diagnostic.filePath))
			: toPosix(diagnostic.filePath);
		return !isPathExcluded(relativePath, normalized);
	});
};
