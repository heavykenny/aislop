import { spawnSync } from "node:child_process";
import path from "node:path";

const MAX_BUFFER = 50 * 1024 * 1024;

const toProjectPath = (rootDirectory: string, filePath: string): string => {
	const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(rootDirectory, filePath);
	return path.relative(rootDirectory, absolutePath).split(path.sep).join("/");
};

// The subset of `files` (relative to rootDirectory) that git would ignore. Returns an
// empty set outside a git repo or on any git failure, so callers fall back to keeping
// every path rather than dropping work they cannot classify.
export const getIgnoredPaths = (rootDirectory: string, files: string[]): Set<string> => {
	if (files.length === 0) return new Set<string>();

	const result = spawnSync("git", ["check-ignore", "--stdin"], {
		cwd: rootDirectory,
		encoding: "utf-8",
		input: files.join("\n"),
		maxBuffer: MAX_BUFFER,
	});

	if (result.error || (result.status !== 0 && result.status !== 1)) {
		return new Set<string>();
	}

	return new Set(
		result.stdout
			.split("\n")
			.map((file) => file.trim())
			.filter((file) => file.length > 0),
	);
};

// Drop any absolute paths that git would ignore, so target discovery (tsconfigs,
// solutions, etc.) skips spikes/scratch checkouts the git-aware source scan already
// excludes. No-op (returns the input) outside a git repo.
export const dropGitIgnoredPaths = (rootDirectory: string, absolutePaths: string[]): string[] => {
	if (absolutePaths.length === 0) return absolutePaths;
	const relativePaths = absolutePaths.map((absolutePath) =>
		toProjectPath(rootDirectory, absolutePath),
	);
	const ignored = getIgnoredPaths(rootDirectory, relativePaths);
	return absolutePaths.filter((_, index) => !ignored.has(relativePaths[index]));
};
