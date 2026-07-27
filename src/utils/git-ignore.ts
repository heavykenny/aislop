import { spawnSync } from "node:child_process";
import path from "node:path";

const MAX_BUFFER = 50 * 1024 * 1024;

const toProjectPath = (rootDirectory: string, filePath: string): string => {
	const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(rootDirectory, filePath);
	return path.relative(rootDirectory, absolutePath).split(path.sep).join("/");
};

interface RootClassification {
	/** Relative path to whether git ignores it. Absent means never sent to git. */
	ignoredByPath: Map<string, boolean>;
	/** A git invocation for this root already failed, so further ones would too. */
	gitInvocationFailed: boolean;
}

// One `git check-ignore --stdin` pass over a large checkout costs minutes (chromium is
// roughly 500k candidate paths), and discovery makes several passes per scan: project
// files, test files, tsconfigs, and .csproj files each arrive as a separate call. Cache
// the verdict per root so any given path is sent to git at most once per process.
const classificationByRoot = new Map<string, RootClassification>();

const getRootClassification = (rootDirectory: string): RootClassification => {
	const rootKey = path.resolve(rootDirectory);
	const existing = classificationByRoot.get(rootKey);
	if (existing) return existing;
	const created: RootClassification = {
		ignoredByPath: new Map<string, boolean>(),
		gitInvocationFailed: false,
	};
	classificationByRoot.set(rootKey, created);
	return created;
};

// Record git's verdict for every path in this batch. check-ignore echoes back exactly
// the ignored input lines, so anything absent from stdout is kept.
const recordBatch = (
	classification: RootClassification,
	requestedPaths: string[],
	stdout: string,
): void => {
	const ignored = new Set(
		stdout
			.split("\n")
			.map((file) => file.trim())
			.filter((file) => file.length > 0),
	);
	for (const requestedPath of requestedPaths) {
		classification.ignoredByPath.set(requestedPath, ignored.has(requestedPath));
	}
};

const classifyNewPaths = (
	rootDirectory: string,
	classification: RootClassification,
	newPaths: string[],
): void => {
	if (newPaths.length === 0 || classification.gitInvocationFailed) return;

	const result = spawnSync("git", ["check-ignore", "--stdin"], {
		cwd: rootDirectory,
		encoding: "utf-8",
		input: newPaths.join("\n"),
		maxBuffer: MAX_BUFFER,
	});

	// check-ignore exits 0 when it ignores something and 1 when it ignores nothing; any
	// other status means git could not answer (no repository, missing binary, overflowed
	// buffer). Remember that per root, or every later pass repeats the same slow failure.
	if (result.error || (result.status !== 0 && result.status !== 1)) {
		classification.gitInvocationFailed = true;
		return;
	}

	recordBatch(classification, newPaths, result.stdout);
};

// The subset of `files` (relative to rootDirectory) that git would ignore. Returns an
// empty set outside a git repo or on any git failure, so callers fall back to keeping
// every path rather than dropping work they cannot classify.
export const getIgnoredPaths = (rootDirectory: string, files: string[]): Set<string> => {
	if (files.length === 0) return new Set<string>();

	const classification = getRootClassification(rootDirectory);
	const newPaths = files.filter((file) => !classification.ignoredByPath.has(file));
	classifyNewPaths(rootDirectory, classification, newPaths);

	const ignoredPaths = new Set<string>();
	for (const file of files) {
		if (classification.ignoredByPath.get(file)) ignoredPaths.add(file);
	}
	return ignoredPaths;
};

// Tests only: within a scan the classification is meant to live for the whole process.
export const resetGitIgnoreCacheForTests = (): void => {
	classificationByRoot.clear();
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
