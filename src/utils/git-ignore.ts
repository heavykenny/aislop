import { spawnSync } from "node:child_process";
import path from "node:path";

// Chromium, the largest checkout measured, snapshots 499,769 paths as 39MB of
// NUL-delimited output, so the ceiling has to stay well above that. Overflowing it is not
// a correctness hazard: spawnSync reports it as an error, which lands in the failure path
// below and leaves every path classified as kept.
const MAX_BUFFER = 50 * 1024 * 1024;

// Every tracked file plus every untracked file git does not ignore. `git check-ignore`
// consults the index unless given --no-index, so it never reports a tracked file as
// ignored even when a pattern matches it; listing --cached alongside --others reproduces
// that exactly. -z keeps non-ASCII names as raw bytes, where the default listing would
// apply core.quotepath C-style escaping and no membership test would match.
const NOT_IGNORED_ARGUMENTS = ["ls-files", "--cached", "--others", "--exclude-standard", "-z"];

// core.ignorecase defaults to true on Windows and macOS checkouts (case-insensitive
// filesystems), and git honors it in both wildmatch pattern matching and the index's
// name lookup. A missing key (never configured) and a non-zero exit both mean "not set",
// which reads the same as false: fold nothing.
const IGNORE_CASE_ARGUMENTS = ["config", "--type=bool", "core.ignorecase"];

const toProjectPath = (rootDirectory: string, filePath: string): string => {
	const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(rootDirectory, filePath);
	return path.relative(rootDirectory, absolutePath).split(path.sep).join("/");
};

// git's own case folding, in wildmatch (WM_CASEFOLD) and the on-disk index's name-hash
// alike, is a byte-wise ASCII tolower: it lowercases A-Z and leaves every other byte,
// including every non-ASCII code point, untouched. String.prototype.toLowerCase performs
// a full Unicode case fold instead, which would treat distinct bytes such as U+00DC (Ü)
// and U+00FC (ü) as equal even though git keeps them apart under core.ignorecase=true.
// Folding only A-Z here mirrors what git actually does.
const foldAsciiCase = (value: string): string =>
	value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

interface RootSnapshot {
	/** Root-relative paths git does not ignore, case-folded per `ignoreCase`. A path outside this set is ignored. */
	notIgnoredPaths: Set<string>;
	/** core.ignorecase for this root. When true, membership tests fold ASCII case to match git's own semantics. */
	ignoreCase: boolean;
	/** A git invocation for this root already failed, so further ones would too. */
	gitInvocationFailed: boolean;
}

// A `git check-ignore --stdin` pass over a large checkout costs minutes (17 for llvm at
// 180k paths, 117 for chromium at 499k) because it evaluates every pattern against every
// path, and discovery makes several passes per scan: project files, test files, tsconfigs,
// and .csproj files each arrive as a separate call. One `git ls-files` enumeration answers
// the same question from git's own index and exclude machinery in under two seconds, and
// it covers every path under the root, so later calls need no further invocation.
const snapshotByRoot = new Map<string, RootSnapshot>();

const readIgnoreCase = (rootDirectory: string): boolean => {
	const result = spawnSync("git", IGNORE_CASE_ARGUMENTS, {
		cwd: rootDirectory,
		encoding: "utf-8",
	});
	if (result.error || result.status !== 0) return false;
	return result.stdout.trim() === "true";
};

const buildSnapshot = (rootDirectory: string): RootSnapshot => {
	const result = spawnSync("git", NOT_IGNORED_ARGUMENTS, {
		cwd: rootDirectory,
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
	});

	// ls-files exits 0 whether or not it printed anything, so any other status means git
	// could not answer (no repository, missing binary, overflowed buffer). Remember that per
	// root, or every later pass repeats the same failure.
	if (result.error || result.status !== 0) {
		return { notIgnoredPaths: new Set<string>(), ignoreCase: false, gitInvocationFailed: true };
	}

	const ignoreCase = readIgnoreCase(rootDirectory);
	// The listing also carries tracked symlinks and submodule gitlink entries. Callers only
	// ask about regular files, so their presence cannot change an answer.
	const entries = result.stdout.split("\0").filter((entry) => entry.length > 0);
	return {
		notIgnoredPaths: new Set(ignoreCase ? entries.map(foldAsciiCase) : entries),
		ignoreCase,
		gitInvocationFailed: false,
	};
};

const getRootSnapshot = (rootDirectory: string): RootSnapshot => {
	const rootKey = path.resolve(rootDirectory);
	const existing = snapshotByRoot.get(rootKey);
	if (existing) return existing;
	const created = buildSnapshot(rootDirectory);
	snapshotByRoot.set(rootKey, created);
	return created;
};

// The subset of `files` (relative to rootDirectory) that git would ignore. Returns an
// empty set outside a git repo or on any git failure, so callers fall back to keeping
// every path rather than dropping work they cannot classify. Callers pass paths that exist
// on disk; a path that does not is absent from the snapshot and so reads as ignored.
export const getIgnoredPaths = (rootDirectory: string, files: string[]): Set<string> => {
	if (files.length === 0) return new Set<string>();

	const snapshot = getRootSnapshot(rootDirectory);
	if (snapshot.gitInvocationFailed) return new Set<string>();

	const ignoredPaths = new Set<string>();
	for (const file of files) {
		const lookupKey = snapshot.ignoreCase ? foldAsciiCase(file) : file;
		if (!snapshot.notIgnoredPaths.has(lookupKey)) ignoredPaths.add(file);
	}
	return ignoredPaths;
};

// Tests only: within a scan the snapshot is meant to live for the whole process.
export const resetGitIgnoreCacheForTests = (): void => {
	snapshotByRoot.clear();
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
