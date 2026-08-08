import fs from "node:fs";
import path from "node:path";
import { isPathExcluded, normalizeExcludePatterns } from "../utils/exclude.js";
import { dropGitIgnoredPaths } from "../utils/git-ignore.js";
import { toPosix } from "../utils/paths.js";
import type { Diagnostic, EngineContext } from "./types.js";

// Build-output and vendor directories that never hold first-party project files.
const IGNORED_DIRECTORIES = new Set(["bin", "obj", "node_modules", ".git", ".vs"]);

// Drop project files under a user-excluded path so excluded projects (vendored
// submodules, `.claude/` scratch) are never restored or analyzed - the diagnostic
// post-filter would discard their findings anyway, and skipping them here also
// keeps them out of the projects-skipped notice and off the restore critical path.
const dropExcludedProjects = (
	root: string,
	projects: string[],
	excludePatterns?: string[],
): string[] => {
	if (!excludePatterns || excludePatterns.length === 0) return projects;
	const normalized = normalizeExcludePatterns(excludePatterns);
	if (normalized.length === 0) return projects;
	return projects.filter(
		(project) => !isPathExcluded(toPosix(path.relative(root, project)), normalized),
	);
};

// Recursively collect every .csproj under `root`, skipping the directories above.
const collectCsprojFiles = (root: string): string[] => {
	const results: string[] = [];
	const walk = (directory: string): void => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!IGNORED_DIRECTORIES.has(entry.name)) walk(fullPath);
			} else if (entry.name.endsWith(".csproj")) {
				results.push(fullPath);
			}
		}
	};
	walk(root);
	return results;
};

export const findCsprojFiles = (root: string, excludePatterns?: string[]): string[] => {
	const results = collectCsprojFiles(root);
	// Honor .gitignore: the raw walk would otherwise lint projects under ignored
	// directories (spikes, scratch checkouts) that the git-aware file discovery skips.
	return dropExcludedProjects(root, dropGitIgnoredPaths(root, results), excludePatterns);
};

// Even a restored project costs a full MSBuild workspace load per invocation, so
// an unbounded per-project fan-out (dotnet/runtime has thousands of .csproj files)
// would run for hours. Solutions are exempt: one solution is a single bounded pass.
export const MAXIMUM_PROJECT_TARGETS = 32;

export interface DotnetTargetSelection {
	/** What to analyze: the solution, or restored projects up to the cap. */
	targets: string[];
	/** Projects skipped because they carry no restore evidence. */
	coldProjects: string[];
	/** Restored projects dropped by MAXIMUM_PROJECT_TARGETS. */
	overCapProjects: string[];
}

const emptySelection = (): DotnetTargetSelection => ({
	targets: [],
	coldProjects: [],
	overCapProjects: [],
});

// project.assets.json is written by a successful `dotnet restore`, so its
// presence means the developer or CI already built the project and an MSBuild
// workspace load will be fast and useful. Without it, every build-backed pass
// serially burns its full restore-plus-analyze timeout on the project - the C#
// analogue of clang-tidy gating on compile_commands.json. Two layouts: the SDK
// default (obj/ beside the .csproj) and the arcade-style central layout
// (dotnet/runtime, roslyn, aspnetcore), where Directory.Build.props redirects
// intermediates to <root>/artifacts/obj/<ProjectName>/.
export const hasRestoreEvidence = (csprojPath: string, rootDirectory: string): boolean => {
	if (fs.existsSync(path.join(path.dirname(csprojPath), "obj", "project.assets.json"))) {
		return true;
	}
	const projectName = path.basename(csprojPath, ".csproj");
	return fs.existsSync(
		path.join(rootDirectory, "artifacts", "obj", projectName, "project.assets.json"),
	);
};

const selectRestoredProjects = (
	csprojFiles: string[],
	rootDirectory: string,
): DotnetTargetSelection => {
	const restored: string[] = [];
	const coldProjects: string[] = [];
	for (const csproj of csprojFiles) {
		(hasRestoreEvidence(csproj, rootDirectory) ? restored : coldProjects).push(csproj);
	}
	return {
		targets: restored.slice(0, MAXIMUM_PROJECT_TARGETS),
		coldProjects,
		overCapProjects: restored.slice(MAXIMUM_PROJECT_TARGETS),
	};
};

const findSolutionOrProjects = (
	root: string,
	solutionExtensions: string[],
	excludePatterns?: string[],
): DotnetTargetSelection => {
	let entries: string[];
	try {
		entries = fs.readdirSync(root);
	} catch {
		return emptySelection();
	}
	let solution: string | undefined;
	for (const extension of solutionExtensions) {
		solution = entries.find((name) => name.endsWith(extension));
		if (solution) break;
	}
	const allProjects = collectCsprojFiles(root);
	const visibleProjects = dropExcludedProjects(
		root,
		dropGitIgnoredPaths(root, allProjects),
		excludePatterns,
	);
	if (solution && visibleProjects.length === allProjects.length) {
		return {
			...emptySelection(),
			targets: dropGitIgnoredPaths(root, [path.join(root, solution)]),
		};
	}
	return selectRestoredProjects(visibleProjects, root);
};

// Targets for the Roslynator lint pass. Prefer a classic .sln: roslynator loads
// it natively in a single pass with full project-reference context. Otherwise fall
// back to the restored .csproj files in the tree: a lone .slnx is not a reliable
// roslynator target (MSBuild's solution parser fails to load .slnx on some SDKs,
// notably .NET 10), and projects routinely live in subdirectories rather than at
// the root.
export const findDotnetTargets = (
	context: Pick<EngineContext, "rootDirectory" | "excludePatterns">,
): DotnetTargetSelection =>
	findSolutionOrProjects(context.rootDirectory, [".sln"], context.excludePatterns);

// Targets for the jb (ReSharper CLT) lint pass. Unlike roslynator, jb inspectcode
// loads a .slnx solution natively, so prefer a single solution target - .sln
// first, then .slnx - for full project-reference context. Inspecting projects one
// at a time loses cross-project symbol resolution and floods CSharpErrors
// ("Cannot resolve symbol", "has no constructors defined"). Fall back to the
// restored .csproj files only when no solution file exists.
export const findJbTargets = (
	context: Pick<EngineContext, "rootDirectory" | "excludePatterns">,
): DotnetTargetSelection =>
	findSolutionOrProjects(context.rootDirectory, [".sln", ".slnx"], context.excludePatterns);

// One advisory notice per lint pass - never one per project - telling the user
// which build-backed C# work was skipped and how to include it. Mirrors
// security/dependency-audit-skipped: visibility loss, not evidence of a defect.
// Roslynator and jb emit identical notices; dedupeCsharpDiagnostics collapses them.
export const projectsSkippedNotice = (
	selection: DotnetTargetSelection,
	rootDirectory: string,
): Diagnostic[] => {
	const skipped = [...selection.coldProjects, ...selection.overCapProjects];
	if (skipped.length === 0) return [];
	const reasons: string[] = [];
	if (selection.coldProjects.length > 0) {
		reasons.push(`${selection.coldProjects.length} with no restore evidence (project.assets.json)`);
	}
	if (selection.overCapProjects.length > 0) {
		reasons.push(
			`${selection.overCapProjects.length} beyond the ${MAXIMUM_PROJECT_TARGETS}-project cap`,
		);
	}
	return [
		{
			filePath: toPosix(path.relative(rootDirectory, skipped[0])),
			engine: "lint",
			rule: "dotnet/projects-skipped",
			severity: "info",
			message: `Build-backed C# lint skipped ${skipped.length} project${
				skipped.length === 1 ? "" : "s"
			}: ${reasons.join("; ")}`,
			help: "Run `dotnet restore` (or a build) for the projects you want analyzed, or add a root .sln so one solution pass covers them.",
			line: 0,
			column: 0,
			category: "C# Lint",
			fixable: false,
		},
	];
};
