import fs from "node:fs";
import path from "node:path";
import {
	addPyDep,
	collectFromPipfile,
	collectFromPyproject,
	collectFromRequirementsTxt,
	PYTHON_MANIFEST_FILES,
} from "./python-dependency-parser.js";
import { expandWorkspaceMemberDirs, isWithinWorkspaceRoot } from "./uv-workspace-patterns.js";
import { readUvWorkspaceDefinition } from "./uv-workspace-definition.js";

export interface PythonDependencyScope {
	directory: string;
	pyDeps: Set<string>;
	hasPyManifest: boolean;
}

const LOCAL_PACKAGE_ROOTS = ["", "src", "lib"];

const collectLocalPythonPackages = (rootDir: string, pyDeps: Set<string>): void => {
	for (const sub of LOCAL_PACKAGE_ROOTS) {
		const dir = sub ? path.join(rootDir, sub) : rootDir;
		let entries: import("node:fs").Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules" || entry.name === "__pycache__") continue;
			const initPath = path.join(dir, entry.name, "__init__.py");
			if (fs.existsSync(initPath)) addPyDep(pyDeps, entry.name);
		}
	}
};

const collectScope = (rootDir: string): PythonDependencyScope => {
	const pyDeps = new Set<string>();
	const hasReq = collectFromRequirementsTxt(rootDir, pyDeps);
	const hasPyproject = collectFromPyproject(rootDir, pyDeps);
	const hasPipfile = collectFromPipfile(rootDir, pyDeps);
	collectLocalPythonPackages(rootDir, pyDeps);
	return {
		directory: rootDir,
		pyDeps,
		hasPyManifest: hasReq || hasPyproject || hasPipfile,
	};
};

const SKIP_MANIFEST_DIRS = new Set([
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
const NESTED_PY_MANIFEST_DEPTH = 4;

const collectNestedScopes = (rootDir: string): PythonDependencyScope[] => {
	const scopes: PythonDependencyScope[] = [];

	const walk = (dir: string, depth: number): void => {
		if (depth > NESTED_PY_MANIFEST_DEPTH) return;
		let entries: import("node:fs").Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		const hasManifest = entries.some(
			(entry) =>
				entry.isFile() && PYTHON_MANIFEST_FILES.some((fileName) => fileName === entry.name),
		);
		if (dir !== rootDir && hasManifest) {
			const scope = collectScope(dir);
			if (scope.hasPyManifest) scopes.push(scope);
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith(".") || SKIP_MANIFEST_DIRS.has(entry.name)) continue;
			walk(path.join(dir, entry.name), depth + 1);
		}
	};

	walk(rootDir, 0);
	return scopes;
};

const findNearestPythonManifestDirectory = (
	startDir: string,
	boundaryDir: string,
): string | null => {
	let directory = path.resolve(startDir);
	const boundary = path.resolve(boundaryDir);
	while (isWithinWorkspaceRoot(boundary, directory)) {
		if (PYTHON_MANIFEST_FILES.some((fileName) => fs.existsSync(path.join(directory, fileName)))) {
			return directory;
		}
		if (directory === boundary) break;
		const parent = path.dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	return null;
};

interface UvWorkspaceInfo {
	rootDir: string;
	appliesToStartDir: boolean;
	sharedDeps: Set<string>;
	memberDirs: string[];
	excludedDirs: string[];
}

const MAX_WORKSPACE_WALKUP = 32;

const emptyUvWorkspace = (rootDir: string, startDir: string): UvWorkspaceInfo => {
	const startProjectDir = findNearestPythonManifestDirectory(startDir, rootDir);
	return {
		rootDir,
		appliesToStartDir: startProjectDir === rootDir,
		sharedDeps: new Set(),
		memberDirs: [],
		excludedDirs: [],
	};
};

// Walk up from startDir to the nearest pyproject declaring [tool.uv.workspace].
// The scan root is usually the workspace root (found immediately); walking up
// also covers scanning a single member directory in isolation.
const findUvWorkspace = (startDir: string): UvWorkspaceInfo | null => {
	let dir = path.resolve(startDir);
	for (let i = 0; i < MAX_WORKSPACE_WALKUP; i += 1) {
		const pyprojPath = path.join(dir, "pyproject.toml");
		if (fs.existsSync(pyprojPath)) {
			const workspace = readUvWorkspaceDefinition(dir);
			if (workspace.kind === "invalid" || workspace.kind === "unmanaged") {
				return emptyUvWorkspace(dir, startDir);
			}
			if (workspace.kind === "workspace") {
				const sharedDeps = new Set<string>();
				// Root [project] deps/extras/groups + root name + root-level packages.
				collectFromPyproject(dir, sharedDeps);
				collectLocalPythonPackages(dir, sharedDeps);
				// `exclude` globs remove directories the `members` globs matched -
				// an excluded project is NOT installed into the shared .venv, so its
				// deps must not suppress findings elsewhere in the workspace.
				const expansion = expandWorkspaceMemberDirs({
					rootDir: dir,
					memberPatterns: workspace.members,
					excludePatterns: workspace.exclude,
					rootProjectName: workspace.rootProjectName,
				});
				if (expansion === null) {
					return emptyUvWorkspace(dir, startDir);
				}
				const { memberDirs, excludedDirs } = expansion;
				const startProjectDir = findNearestPythonManifestDirectory(startDir, dir);
				const appliesToStartDir =
					startProjectDir === dir ||
					(startProjectDir !== null && memberDirs.includes(startProjectDir));
				// Each member's full scope: its declared deps AND its package name /
				// src-layout module names (the shared .venv installs all of them).
				for (const memberDir of memberDirs) {
					const memberScope = collectScope(memberDir);
					for (const dep of memberScope.pyDeps) sharedDeps.add(dep);
				}
				return { rootDir: dir, appliesToStartDir, sharedDeps, memberDirs, excludedDirs };
			}
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
};

export const collectPythonDeps = (
	rootDir: string,
): {
	pyDeps: Set<string>;
	hasPyManifest: boolean;
	rootHasPyManifest: boolean;
	scopes: PythonDependencyScope[];
	workspaceDeps: Set<string> | null;
	workspaceRootDir: string | null;
	workspaceMemberDirs: string[];
} => {
	const rootScope = collectScope(rootDir);
	const nestedScopes = collectNestedScopes(rootDir);
	const scopes = [rootScope, ...nestedScopes];
	const workspace = findUvWorkspace(rootDir);
	if (workspace) {
		const ancestorProjectDir = findNearestPythonManifestDirectory(rootDir, workspace.rootDir);
		if (ancestorProjectDir && !scopes.some((scope) => scope.directory === ancestorProjectDir)) {
			const ancestorScope = collectScope(ancestorProjectDir);
			if (ancestorScope.hasPyManifest) scopes.push(ancestorScope);
		}
	}
	for (const excludedDir of workspace?.excludedDirs ?? []) {
		if (scopes.some((scope) => scope.directory === excludedDir)) continue;
		const excludedScope = collectScope(excludedDir);
		if (excludedScope.hasPyManifest) scopes.push(excludedScope);
	}
	const pyDeps = new Set<string>();
	for (const scope of scopes) {
		for (const dep of scope.pyDeps) pyDeps.add(dep);
	}
	return {
		pyDeps,
		// An ancestor uv workspace counts as a manifest: scanning a member
		// subdirectory (e.g. `aislop scan packages/api/src`) finds no
		// pyproject/requirements under the scan root, but the workspace's shared
		// dependency set still applies to every file in it.
		hasPyManifest:
			scopes.some((scope) => scope.hasPyManifest) || workspace?.appliesToStartDir === true,
		rootHasPyManifest: rootScope.hasPyManifest,
		scopes,
		workspaceDeps: workspace?.appliesToStartDir ? workspace.sharedDeps : null,
		workspaceRootDir: workspace?.appliesToStartDir ? workspace.rootDir : null,
		workspaceMemberDirs: workspace?.appliesToStartDir ? workspace.memberDirs : [],
	};
};
