import fs from "node:fs";
import path from "node:path";
import { safeProjectFilePath } from "../../utils/project-path-safety.js";
import { collectWorkspaceDirs } from "./js-workspaces.js";
import { PYTHON_MANIFEST_FILES } from "./python-dependency-parser.js";
import { collectPythonDeps, type PythonDependencyScope } from "./python-manifest.js";

interface JsDependencyScope {
	directory: string;
	jsDeps: Set<string>;
	packageName?: string;
}

interface PackageManifest {
	jsDeps: Set<string>;
	jsScopes: JsDependencyScope[];
	pyDeps: Set<string>;
	hasJsManifest: boolean;
	hasPyManifest: boolean;
	rootHasPyManifest: boolean;
	pyScopes: PythonDependencyScope[];
	workspaceDeps: Set<string> | null;
	workspaceRootDir: string | null;
	workspaceMemberDirs: string[];
}

export const readJson = (filePath: string, rootDirectory = path.dirname(filePath)): unknown => {
	try {
		const safePath = safeProjectFilePath(filePath, rootDirectory);
		return safePath ? JSON.parse(fs.readFileSync(safePath, "utf-8")) : null;
	} catch {
		return null;
	}
};

const PKG_DEP_SECTIONS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
];

const addDepsFromPkg = (pkg: Record<string, unknown>, jsDeps: Set<string>): void => {
	for (const section of PKG_DEP_SECTIONS) {
		const deps = pkg[section];
		if (deps && typeof deps === "object") {
			for (const name of Object.keys(deps as Record<string, unknown>)) {
				jsDeps.add(name);
			}
		}
	}
};

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "target", "coverage"]);

const mergeDeps = (target: Set<string>, source: Set<string>): void => {
	for (const dep of source) target.add(dep);
};

const collectJsScope = (directory: string, rootDirectory: string): JsDependencyScope | null => {
	const pkgPath = path.join(directory, "package.json");
	const pkg = readJson(pkgPath, rootDirectory) as Record<string, unknown> | null;
	if (!pkg || typeof pkg !== "object") return null;
	const jsDeps = new Set<string>();
	addDepsFromPkg(pkg, jsDeps);
	const packageName = typeof pkg.name === "string" ? pkg.name : undefined;
	if (packageName) jsDeps.add(packageName);
	return { directory, jsDeps, packageName };
};

const hasPackageManifest = (filePath: string): boolean => {
	try {
		const stats = fs.lstatSync(filePath);
		return stats.isFile() || stats.isSymbolicLink();
	} catch {
		return false;
	}
};

const collectJsScopes = (rootDir: string): JsDependencyScope[] => {
	const scopes: JsDependencyScope[] = [];
	const walk = (dir: string): void => {
		const pkgPath = path.join(dir, "package.json");
		const scope = collectJsScope(dir, rootDir);
		if (scope) scopes.push(scope);
		else if (hasPackageManifest(pkgPath)) {
			scopes.push({ directory: dir, jsDeps: new Set() });
		}
		let entries: import("node:fs").Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith(".") && entry.name !== ".github") continue;
			if (SKIP_DIRS.has(entry.name)) continue;
			walk(path.join(dir, entry.name));
		}
	};
	walk(rootDir);
	return scopes;
};

const collectJsDeps = (
	rootDir: string,
	jsDeps: Set<string>,
	jsScopes: JsDependencyScope[],
): boolean => {
	const pkgPath = path.join(rootDir, "package.json");
	const pkg = readJson(pkgPath, rootDir) as Record<string, unknown> | null;
	if (!pkg || typeof pkg !== "object") return jsScopes.length > 0;

	for (const scope of jsScopes) {
		mergeDeps(jsDeps, scope.jsDeps);
	}

	const workspaceDirs = collectWorkspaceDirs(rootDir, pkg);
	for (const wsDir of workspaceDirs) {
		const wsPkg = readJson(path.join(wsDir, "package.json"), rootDir) as Record<
			string,
			unknown
		> | null;
		if (!wsPkg) continue;
		if (typeof wsPkg.name === "string") jsDeps.add(wsPkg.name);
		addDepsFromPkg(wsPkg, jsDeps);
	}
	return true;
};

export const loadManifest = (rootDir: string): PackageManifest => {
	const jsScopes = collectJsScopes(rootDir);
	const jsDeps = new Set<string>();
	const hasJsManifest = collectJsDeps(rootDir, jsDeps, jsScopes);
	const {
		pyDeps,
		hasPyManifest,
		rootHasPyManifest,
		scopes,
		workspaceDeps,
		workspaceRootDir,
		workspaceMemberDirs,
	} = collectPythonDeps(rootDir);
	return {
		jsDeps,
		jsScopes,
		pyDeps,
		hasJsManifest,
		hasPyManifest,
		rootHasPyManifest,
		pyScopes: scopes,
		workspaceDeps,
		workspaceRootDir,
		workspaceMemberDirs,
	};
};

const isWithinDirectory = (filePath: string, directory: string): boolean => {
	const relative = path.relative(directory, filePath);
	return (
		relative === "" ||
		(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
	);
};

const isWorkspaceProjectFile = (manifest: PackageManifest, filePath: string): boolean => {
	if (!manifest.workspaceRootDir) return false;
	const workspaceRoot = path.resolve(manifest.workspaceRootDir);
	let directory = path.dirname(path.resolve(filePath));
	while (isWithinDirectory(directory, workspaceRoot)) {
		if (PYTHON_MANIFEST_FILES.some((fileName) => fs.existsSync(path.join(directory, fileName)))) {
			return (
				directory === workspaceRoot ||
				manifest.workspaceMemberDirs.some((memberDir) => path.resolve(memberDir) === directory)
			);
		}
		if (directory === workspaceRoot) break;
		const parent = path.dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	return false;
};

export const jsDepsForFile = (
	manifest: PackageManifest,
	filePath: string,
	rootDirectory: string,
): Set<string> => {
	const deps = new Set<string>();
	for (const scope of manifest.jsScopes) {
		if (scope.packageName) deps.add(scope.packageName);
	}

	const nearestScope = manifest.jsScopes
		.filter(
			(scope) => scope.directory !== rootDirectory && isWithinDirectory(filePath, scope.directory),
		)
		.sort((a, b) => b.directory.length - a.directory.length)[0];

	if (nearestScope) {
		mergeDeps(deps, nearestScope.jsDeps);
		return deps;
	}

	const rootScope = manifest.jsScopes.find((scope) => scope.directory === rootDirectory);
	if (rootScope) mergeDeps(deps, rootScope.jsDeps);
	else mergeDeps(deps, manifest.jsDeps);
	return deps;
};

const nearestPythonScope = (
	manifest: PackageManifest,
	filePath: string,
	rootDirectory: string,
): PythonDependencyScope | undefined =>
	manifest.pyScopes
		.filter(
			(scope) =>
				scope.directory !== rootDirectory &&
				scope.hasPyManifest &&
				isWithinDirectory(filePath, scope.directory),
		)
		.sort((a, b) => b.directory.length - a.directory.length)[0];

export const pythonImportRootForFile = (
	manifest: PackageManifest,
	filePath: string,
	rootDirectory: string,
): string => nearestPythonScope(manifest, filePath, rootDirectory)?.directory ?? rootDirectory;

export const pythonDepsForFile = (
	manifest: PackageManifest,
	filePath: string,
	rootDirectory: string,
): Set<string> | null => {
	const deps = new Set<string>();
	const rootScope = manifest.pyScopes.find((scope) => scope.directory === rootDirectory);
	const workspaceProjectFile =
		manifest.workspaceDeps !== null && isWorkspaceProjectFile(manifest, filePath);
	if (
		manifest.rootHasPyManifest &&
		rootScope &&
		(manifest.workspaceDeps === null || workspaceProjectFile)
	) {
		mergeDeps(deps, rootScope.pyDeps);
	}

	const nestedScope = nearestPythonScope(manifest, filePath, rootDirectory);
	if (nestedScope) mergeDeps(deps, nestedScope.pyDeps);

	const workspaceDeps = workspaceProjectFile ? manifest.workspaceDeps : null;
	if (workspaceDeps) mergeDeps(deps, workspaceDeps);

	if (!manifest.rootHasPyManifest && !nestedScope && !workspaceDeps) return null;
	if (deps.size === 0 && manifest.pyDeps.size > 0 && !manifest.workspaceDeps) {
		return manifest.pyDeps;
	}
	return deps;
};
