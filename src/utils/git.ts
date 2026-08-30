import { spawnSync } from "node:child_process";
import path from "node:path";
import { type ChangedLines, parseUnifiedDiffHunks } from "./change-context.js";
import { projectRelativePosix } from "./paths.js";

const MAX_BUFFER = 50 * 1024 * 1024;

// Separates a missing/unfetched base ref from a genuine empty diff.
export const baseRefExists = (cwd: string, ref: string): boolean => {
	const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
		cwd,
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
	});
	return !result.error && result.status === 0;
};

export const getChangedFiles = (cwd: string, base?: string): string[] => {
	const baseRef = base ?? "HEAD";
	const diff = spawnSync("git", ["diff", "--no-color", "--name-only", "--diff-filter=ACMR", baseRef], {
		cwd,
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
	});
	if (diff.error || diff.status !== 0) return [];

	const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
		cwd,
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
	});

	const names = new Set<string>();
	for (const line of diff.stdout.split("\n")) {
		if (line.length > 0) names.add(line);
	}
	if (!untracked.error && untracked.status === 0) {
		for (const line of untracked.stdout.split("\n")) {
			if (line.length > 0) names.add(line);
		}
	}

	return Array.from(names).map((f) => path.resolve(cwd, f));
};

export const getStagedFiles = (cwd: string): string[] => {
	const result = spawnSync("git", ["diff", "--no-color", "--cached", "--name-only", "--diff-filter=ACMR"], {
		cwd,
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
	});
	if (result.error || result.status !== 0) return [];
	return result.stdout
		.split("\n")
		.filter((f) => f.length > 0)
		.map((f) => path.resolve(cwd, f));
};

const listUntrackedFiles = (cwd: string): string[] => {
	const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
		cwd,
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
	});
	if (untracked.error || untracked.status !== 0) return [];
	return untracked.stdout.split("\n").filter((line) => line.length > 0);
};

export const getChangedLineMap = (cwd: string, base?: string): Map<string, ChangedLines> => {
	const baseRef = base ?? "HEAD";
	const diff = spawnSync("git", ["diff", "--no-color", "-U0", "--diff-filter=ACMR", baseRef], {
		cwd,
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
	});
	const map = !diff.error && diff.status === 0 ? parseUnifiedDiffHunks(diff.stdout) : new Map();
	for (const name of listUntrackedFiles(cwd)) {
		map.set(projectRelativePosix(cwd, path.resolve(cwd, name)), { kind: "all" });
	}
	return map;
};
