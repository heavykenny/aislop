import { spawnSync } from "node:child_process";
import path from "node:path";

const MAX_BUFFER = 50 * 1024 * 1024;

export const getChangedFiles = (cwd: string, base?: string): string[] => {
	const baseRef = base ?? "HEAD";
	const result = spawnSync("git", ["diff", "--name-only", "--diff-filter=ACMR", baseRef], {
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

export const getStagedFiles = (cwd: string): string[] => {
	const result = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
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
