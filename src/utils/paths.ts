import path from "node:path";

/** Normalize an OS path to forward-slash (POSIX) separators. */
export const toPosix = (p: string): string => p.split(path.sep).join("/");

/** path.relative, normalized to POSIX separators (stable across OSes). */
export const relativePosix = (from: string, to: string): string => toPosix(path.relative(from, to));

const stripWindowsNamespace = (filePath: string): string => {
	if (filePath.startsWith("\\\\?\\UNC\\")) return `\\\\${filePath.slice(8)}`;
	return filePath.startsWith("\\\\?\\") ? filePath.slice(4) : filePath;
};

export const projectRelativePosix = (rootDirectory: string, filePath: string): string => {
	if (process.platform === "win32") {
		const normalizedRoot = stripWindowsNamespace(rootDirectory);
		const normalizedFile = stripWindowsNamespace(filePath);
		const relativePath = path.win32.isAbsolute(normalizedFile)
			? path.win32.relative(normalizedRoot, normalizedFile)
			: normalizedFile;
		return relativePath.split(path.win32.sep).join("/");
	}
	return path.isAbsolute(filePath) ? relativePosix(rootDirectory, filePath) : toPosix(filePath);
};
