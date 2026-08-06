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
	// The listing also carries tracked symlinks, and two shapes of embedded repository
	// boundary git does not recurse past: a tracked submodule, listed as a bare gitlink
	// entry with no trailing slash, and an untracked nested repository (a directory
	// holding its own .git), listed as the directory itself with a trailing slash. Strip
	// that slash so both shapes normalize to the same plain path an ancestor-prefix
	// lookup can match; see isBeneathEmbeddedRepository below.
	const entries = result.stdout
		.split("\0")
		.filter((entry) => entry.length > 0)
		.map((entry) => (entry.endsWith("/") ? entry.slice(0, -1) : entry));
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

// A submodule or an untracked nested repository is a boundary git does not recurse past
// when building the snapshot (see buildSnapshot), so no path beneath one is ever a member
// of notIgnoredPaths, however the file walker that produces candidates does recurse into
// it on disk. Without this, every such path would read as ignored on a plain miss. Walk
// candidate's ancestor directories outward; the first one present in the snapshot is that
// boundary, and a path beneath it matches no ignore pattern (verified against a real
// tracked submodule and a real untracked nested repository; see tests/git-ignore.test.ts).
// O(path depth) per miss.
const isBeneathEmbeddedRepository = (snapshot: RootSnapshot, file: string): boolean => {
	let ancestor = file;
	for (;;) {
		const slashIndex = ancestor.lastIndexOf("/");
		if (slashIndex === -1) return false;
		ancestor = ancestor.slice(0, slashIndex);
		const key = snapshot.ignoreCase ? foldAsciiCase(ancestor) : ancestor;
		if (snapshot.notIgnoredPaths.has(key)) return true;
	}
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
		if (snapshot.notIgnoredPaths.has(lookupKey)) continue;
		if (isBeneathEmbeddedRepository(snapshot, file)) continue;
		ignoredPaths.add(file);
	}
	return ignoredPaths;
};

// Discards every cached snapshot so the next getIgnoredPaths/dropGitIgnoredPaths call
// rebuilds from git rather than answering from a listing taken before this call. The
// comment above the cache still holds within a single scan: call this once at the start
// of a scan (discoverProject does, for every scan flavor), not before each individual
// lookup, or the perf win this snapshot exists for disappears. Without a call somewhere,
// a long-lived process such as the MCP server keeps its first scan's snapshot forever and
// misclassifies a file created, deleted, or renamed after that first scan.
export const resetGitIgnoreSnapshots = (): void => {
	snapshotByRoot.clear();
};

// Tests only: identical to resetGitIgnoreSnapshots, kept under its original name so
// existing tests did not need to change when production code gained its own caller.
export const resetGitIgnoreCacheForTests = (): void => {
	resetGitIgnoreSnapshots();
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
