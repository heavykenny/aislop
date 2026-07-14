import path from "node:path";

/** Normalize an OS path to forward-slash (POSIX) separators. */
export const toPosix = (p: string): string => p.split(path.sep).join("/");

/** path.relative, normalized to POSIX separators (stable across OSes). */
export const relativePosix = (from: string, to: string): string => toPosix(path.relative(from, to));

export const projectRelativePosix = (rootDirectory: string, filePath: string): string =>
	path.isAbsolute(filePath) ? relativePosix(rootDirectory, filePath) : toPosix(filePath);
