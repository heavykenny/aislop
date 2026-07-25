import fs from "node:fs";
import path from "node:path";
import { classifyUvWorkspaceMember } from "./uv-workspace-definition.js";
import type { GlobMatchBudget } from "./uv-workspace-glob.js";
import {
	createWorkspaceDescendantMatcher,
	createWorkspacePathMatcher,
	normalizeWorkspacePattern,
	relativeWorkspacePath,
	scanWorkspacePattern,
	workspacePatternsWithinBudget,
} from "./uv-workspace-matchers.js";

const SKIP_WORKSPACE_DIRS = new Set([
	".git",
	".mypy_cache",
	".pytest_cache",
	".ruff_cache",
	".tox",
	".venv",
	"__pycache__",
	"build",
	"dist",
	"node_modules",
	"site-packages",
]);
const MAX_WORKSPACE_DIRECTORIES = 10_000;
const MAX_WORKSPACE_DIRECTORY_ENTRIES = 5_000;
const MAX_WORKSPACE_DEPTH = 32;
const MAX_WORKSPACE_MATCH_STEPS = 200_000;

export const isWithinWorkspaceRoot = (rootDir: string, directory: string): boolean => {
	const relative = path.relative(rootDir, directory);
	return (
		relative === "" ||
		(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
	);
};

const isRealPathWithinWorkspaceRoot = (rootDir: string, directory: string): boolean => {
	try {
		return isWithinWorkspaceRoot(fs.realpathSync(rootDir), fs.realpathSync(directory));
	} catch {
		return false;
	}
};

interface WorkspaceWalkDirectory {
	readonly directory: string;
	readonly shouldTraverse: boolean;
	readonly symbolicLink: boolean;
}

const readWorkspaceChildDirectories = (directory: string): WorkspaceWalkDirectory[] | null => {
	let directoryHandle: import("node:fs").Dir | null = null;
	try {
		directoryHandle = fs.opendirSync(directory);
		const children: WorkspaceWalkDirectory[] = [];
		let entryCount = 0;
		let entry = directoryHandle.readSync();
		while (entry) {
			entryCount += 1;
			if (entryCount > MAX_WORKSPACE_DIRECTORY_ENTRIES) return null;
			const childDirectory = path.join(directory, entry.name);
			const skipped = SKIP_WORKSPACE_DIRS.has(entry.name);
			if (entry.isSymbolicLink()) {
				children.push({
					directory: childDirectory,
					shouldTraverse: !skipped,
					symbolicLink: true,
				});
			} else if (entry.isDirectory()) {
				children.push({
					directory: childDirectory,
					shouldTraverse: !skipped,
					symbolicLink: false,
				});
			}
			entry = directoryHandle.readSync();
		}
		return children;
	} catch {
		return null;
	} finally {
		directoryHandle?.closeSync();
	}
};

interface UvWorkspaceExpansion {
	readonly memberDirs: string[];
	readonly excludedDirs: string[];
}

const normalizeProjectName = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, "-");

interface UvWorkspaceExpansionRequest {
	readonly rootDir: string;
	readonly memberPatterns: readonly string[];
	readonly excludePatterns: readonly string[];
	readonly rootProjectName: string | null;
}

export const expandWorkspaceMemberDirs = ({
	rootDir,
	memberPatterns,
	excludePatterns,
	rootProjectName,
}: UvWorkspaceExpansionRequest): UvWorkspaceExpansion | null => {
	if (!workspacePatternsWithinBudget(memberPatterns)) return null;
	const resolvedRoot = path.resolve(rootDir);
	const dirs = new Set<string>();
	const excludedDirs = new Set<string>();
	const globPatterns: string[] = [];
	const walkRoots = new Set<string>();
	const projectNames = new Set<string>();
	if (rootProjectName) projectNames.add(normalizeProjectName(rootProjectName));
	const processedCandidates = new Set<string>();
	const matchBudget: GlobMatchBudget = { remainingSteps: MAX_WORKSPACE_MATCH_STEPS };
	const excludeMatcher = createWorkspacePathMatcher(excludePatterns, true, matchBudget);
	if (!excludeMatcher) return null;

	const acceptCandidate = (directory: string): boolean => {
		if (processedCandidates.has(directory)) return true;
		processedCandidates.add(directory);
		const excluded = excludeMatcher(resolvedRoot, directory);
		if (excluded === null) return false;
		if (excluded) {
			excludedDirs.add(directory);
			return true;
		}
		if (directory === resolvedRoot) return rootProjectName !== null;
		const admission = classifyUvWorkspaceMember(directory);
		if (admission.kind === "unmanaged") {
			excludedDirs.add(directory);
			return true;
		}
		if (admission.kind === "missing" && path.basename(directory).startsWith(".")) return true;
		if (admission.kind !== "member") return false;
		const projectName = normalizeProjectName(admission.name);
		if (projectNames.has(projectName)) return false;
		projectNames.add(projectName);
		dirs.add(directory);
		return true;
	};

	for (const pattern of new Set(memberPatterns.map(normalizeWorkspacePattern))) {
		const scan = scanWorkspacePattern(pattern);
		if (!scan) return null;
		if (!scan.isGlob) {
			const directory = path.resolve(resolvedRoot, pattern);
			if (!isWithinWorkspaceRoot(resolvedRoot, directory)) return null;
			if (!fs.existsSync(directory)) continue;
			try {
				if (!fs.statSync(directory).isDirectory()) continue;
			} catch {
				return null;
			}
			if (!isRealPathWithinWorkspaceRoot(resolvedRoot, directory)) return null;
			if (!acceptCandidate(directory)) return null;
			continue;
		}

		const walkRoot = path.resolve(resolvedRoot, scan.base || ".");
		if (!isWithinWorkspaceRoot(resolvedRoot, walkRoot)) return null;
		if (!fs.existsSync(walkRoot)) continue;
		try {
			if (!fs.statSync(walkRoot).isDirectory()) continue;
		} catch {
			return null;
		}
		if (!isRealPathWithinWorkspaceRoot(resolvedRoot, walkRoot)) return null;
		globPatterns.push(pattern);
		walkRoots.add(walkRoot);
	}
	const memberMatcher = createWorkspacePathMatcher(globPatterns, false, matchBudget);
	const descendantMatcher = createWorkspaceDescendantMatcher(globPatterns, matchBudget);
	if (!memberMatcher || !descendantMatcher) return null;

	const minimalWalkRoots: string[] = [];
	for (const walkRoot of [...walkRoots].sort((a, b) => a.length - b.length)) {
		if (minimalWalkRoots.some((parent) => isWithinWorkspaceRoot(parent, walkRoot))) continue;
		minimalWalkRoots.push(walkRoot);
	}

	const visited = new Set<string>();
	for (const walkRoot of minimalWalkRoots) {
		const pending: WorkspaceWalkDirectory[] = [
			{ directory: walkRoot, shouldTraverse: true, symbolicLink: false },
		];
		while (pending.length > 0) {
			const nextDirectory = pending.pop();
			if (!nextDirectory || visited.has(nextDirectory.directory)) continue;
			const { directory, shouldTraverse, symbolicLink } = nextDirectory;
			visited.add(directory);
			if (visited.size > MAX_WORKSPACE_DIRECTORIES) return null;
			const matchesMember = memberMatcher(resolvedRoot, directory);
			if (matchesMember === null) return null;
			const matchesDescendant = descendantMatcher(resolvedRoot, directory);
			if (matchesDescendant === null) return null;
			if (symbolicLink) {
				if (!matchesMember && !matchesDescendant) continue;
				const excluded = excludeMatcher(resolvedRoot, directory);
				if (excluded === null) return null;
				if (excluded) continue;
				try {
					if (!fs.statSync(directory).isDirectory()) continue;
				} catch {
					return null;
				}
				return null;
			}
			if (matchesMember && !acceptCandidate(directory)) return null;
			if (!shouldTraverse) {
				if (matchesDescendant) return null;
				continue;
			}
			if (!matchesDescendant) continue;
			const depth = relativeWorkspacePath(resolvedRoot, directory)
				.split("/")
				.filter(Boolean).length;
			const children = readWorkspaceChildDirectories(directory);
			if (children === null) return null;
			if (depth >= MAX_WORKSPACE_DEPTH) {
				if (children.some((child) => child.shouldTraverse)) return null;
				for (const child of children) pending.push(child);
				continue;
			}
			for (const child of children) pending.push(child);
		}
	}

	return { memberDirs: [...dirs], excludedDirs: [...excludedDirs] };
};
