import fs from "node:fs";
import path from "node:path";
import { runSubprocess } from "../utils/subprocess.js";

interface GitState {
	root: string;
	gitCommonDir: string;
	branch: string | null;
	head: string;
	dirty: boolean;
}

interface AgentWorktree {
	originalRoot: string;
	path: string;
	name: string;
	created: boolean;
}

const timestamp = (): string =>
	new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");

const readDirty = async (gitRoot: string): Promise<boolean> => {
	const status = await runSubprocess("git", ["status", "--porcelain"], { cwd: gitRoot });
	return status.stdout.trim().length > 0;
};

const readGitState = async (cwd: string): Promise<GitState> => {
	const root = await runSubprocess("git", ["rev-parse", "--show-toplevel"], { cwd });
	if (root.exitCode !== 0 || !root.stdout) {
		throw new Error("aislop agent needs to run inside a git repository.");
	}
	const gitRoot = root.stdout.trim();
	const [branch, head, status, gitCommonDir] = await Promise.all([
		runSubprocess("git", ["branch", "--show-current"], { cwd: gitRoot }),
		runSubprocess("git", ["rev-parse", "--short", "HEAD"], { cwd: gitRoot }),
		runSubprocess("git", ["status", "--porcelain"], { cwd: gitRoot }),
		runSubprocess("git", ["rev-parse", "--git-common-dir"], { cwd: gitRoot }),
	]);
	const commonDir = gitCommonDir.stdout.trim();
	return {
		root: gitRoot,
		gitCommonDir: path.isAbsolute(commonDir) ? commonDir : path.resolve(gitRoot, commonDir),
		branch: branch.stdout.trim() || null,
		head: head.stdout.trim(),
		dirty: status.stdout.trim().length > 0,
	};
};

const ensureLocalAislopExclude = (gitCommonDir: string): void => {
	const excludePath = path.join(gitCommonDir, "info", "exclude");
	fs.mkdirSync(path.dirname(excludePath), { recursive: true });
	const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf-8") : "";
	const entries = [
		".aislop/worktrees/",
		".aislop/agent/sessions/",
		".aislop/agent/logs/",
		".aislop/agent/monitors/",
		".aislop/agent/provider.json",
	];
	const missingEntries = entries.filter((entry) => !existing.split("\n").includes(entry));
	if (missingEntries.length === 0) return;
	const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
	fs.appendFileSync(
		excludePath,
		`${prefix}# aislop local agent sessions and worktrees\n${missingEntries.join("\n")}\n`,
		"utf-8",
	);
};

export const prepareAgentLocalState = async (cwd: string): Promise<{ root: string }> => {
	const state = await readGitState(cwd);
	ensureLocalAislopExclude(state.gitCommonDir);
	return { root: state.root };
};

export const readAgentRoot = async (cwd: string): Promise<{ root: string }> => {
	const state = await readGitState(cwd);
	return { root: state.root };
};

export const createAgentWorktree = async (cwd: string, opts: { inPlace: boolean }) => {
	const state = await readGitState(cwd);
	ensureLocalAislopExclude(state.gitCommonDir);
	state.dirty = await readDirty(state.root);
	if (opts.inPlace) {
		return {
			state,
			worktree: {
				originalRoot: state.root,
				path: state.root,
				name: "current",
				created: false,
			} satisfies AgentWorktree,
		};
	}
	if (state.dirty) {
		throw new Error(
			"Current worktree has uncommitted changes. Commit/stash them, or rerun with --in-place if you want aislop agent to edit here.",
		);
	}
	const name = `agent-${timestamp()}-${process.pid}`;
	const worktreeRoot = path.join(state.root, ".aislop", "worktrees");
	const worktreePath = path.join(worktreeRoot, name);
	fs.mkdirSync(worktreeRoot, { recursive: true });
	const result = await runSubprocess("git", ["worktree", "add", "--detach", worktreePath, "HEAD"], {
		cwd: state.root,
		timeout: 60_000,
	});
	if (result.exitCode !== 0) {
		throw new Error(result.stderr || result.stdout || "Failed to create git worktree.");
	}
	return {
		state,
		worktree: {
			originalRoot: state.root,
			path: worktreePath,
			name,
			created: true,
		} satisfies AgentWorktree,
	};
};

export const removeAgentWorktree = async (worktree: AgentWorktree): Promise<void> => {
	if (!worktree.created) return;
	await runSubprocess("git", ["worktree", "remove", "--force", worktree.path], {
		cwd: worktree.originalRoot,
		timeout: 60_000,
	});
};

export const diffNameOnly = async (cwd: string): Promise<string[]> => {
	const result = await runSubprocess("git", ["diff", "--name-only"], { cwd });
	if (result.exitCode !== 0) return [];
	return result.stdout.split("\n").filter(Boolean);
};

export interface DiffNumstat {
	filePath: string;
	additions: number | null;
	deletions: number | null;
	binary: boolean;
}

const parseNumstatValue = (value: string): number | null => {
	if (value === "-") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

export const diffNumstat = async (cwd: string): Promise<Map<string, DiffNumstat>> => {
	const result = await runSubprocess("git", ["diff", "--numstat"], { cwd });
	const stats = new Map<string, DiffNumstat>();
	if (result.exitCode !== 0) return stats;
	for (const line of result.stdout.split("\n")) {
		if (!line.trim()) continue;
		const [rawAdditions, rawDeletions, ...pathParts] = line.split("\t");
		const filePath = pathParts.join("\t");
		if (!filePath) continue;
		const additions = parseNumstatValue(rawAdditions ?? "");
		const deletions = parseNumstatValue(rawDeletions ?? "");
		stats.set(filePath, {
			filePath,
			additions,
			deletions,
			binary: additions === null || deletions === null,
		});
	}
	return stats;
};

export const readBinaryDiff = async (cwd: string): Promise<string> => {
	const result = await runSubprocess("git", ["diff", "--binary"], { cwd, timeout: 60_000 });
	if (result.exitCode !== 0) throw new Error(result.stderr || "Failed to read worktree diff.");
	// runSubprocess trims trailing whitespace, but `git apply` is byte-strict and
	// rejects a patch missing its final newline ("corrupt patch at line N").
	return result.stdout.length > 0 ? `${result.stdout}\n` : result.stdout;
};
