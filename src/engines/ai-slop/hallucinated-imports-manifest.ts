import fs from "node:fs";
import path from "node:path";
import { collectWorkspaceDirs } from "./js-workspaces.js";
import { collectPythonDeps, type PythonDependencyScope } from "./python-manifest.js";

export interface JsDependencyScope {
	directory: string;
	jsDeps: Set<string>;
	packageName?: string;
}

export interface PackageManifest {
	jsDeps: Set<string>;
	jsScopes: JsDependencyScope[];
	pyDeps: Set<string>;
	hasJsManifest: boolean;
	hasPyManifest: boolean;
	rootHasPyManifest: boolean;
	pyScopes: PythonDependencyScope[];
}

export const readJson = (filePath: string): unknown => {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
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

const collectJsScope = (directory: string): JsDependencyScope | null => {
	const pkgPath = path.join(directory, "package.json");
	if (!fs.existsSync(pkgPath)) return null;
	const pkg = readJson(pkgPath) as Record<string, unknown> | null;
	if (!pkg || typeof pkg !== "object") return null;
	const jsDeps = new Set<string>();
	addDepsFromPkg(pkg, jsDeps);
	const packageName = typeof pkg.name === "string" ? pkg.name : undefined;
	if (packageName) jsDeps.add(packageName);
	return { directory, jsDeps, packageName };
};

const collectJsScopes = (rootDir: string): JsDependencyScope[] => {
	const scopes: JsDependencyScope[] = [];
	const walk = (dir: string): void => {
		const scope = collectJsScope(dir);
		if (scope) scopes.push(scope);
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
	if (!fs.existsSync(pkgPath)) return jsScopes.length > 0;
	const pkg = readJson(pkgPath) as Record<string, unknown> | null;
	if (!pkg || typeof pkg !== "object") return jsScopes.length > 0;

	for (const scope of jsScopes) {
		mergeDeps(jsDeps, scope.jsDeps);
	}

	const workspaceDirs = collectWorkspaceDirs(rootDir, pkg);
	for (const wsDir of workspaceDirs) {
		const wsPkg = readJson(path.join(wsDir, "package.json")) as Record<string, unknown> | null;
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
	const { pyDeps, hasPyManifest, rootHasPyManifest, scopes } = collectPythonDeps(rootDir);
	return {
		jsDeps,
		jsScopes,
		pyDeps,
		hasJsManifest,
		hasPyManifest,
		rootHasPyManifest,
		pyScopes: scopes,
	};
};

const isWithinDirectory = (filePath: string, directory: string): boolean => {
	const relative = path.relative(directory, filePath);
	return (
		relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
	);
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

export const pythonDepsForFile = (
	manifest: PackageManifest,
	filePath: string,
	rootDirectory: string,
): Set<string> | null => {
	const deps = new Set<string>();
	const rootScope = manifest.pyScopes.find((scope) => scope.directory === rootDirectory);
	if (manifest.rootHasPyManifest && rootScope) mergeDeps(deps, rootScope.pyDeps);

	const nestedScope = manifest.pyScopes
		.filter(
			(scope) =>
				scope.directory !== rootDirectory &&
				scope.hasPyManifest &&
				isWithinDirectory(filePath, scope.directory),
		)
		.sort((a, b) => b.directory.length - a.directory.length)[0];
	if (nestedScope) mergeDeps(deps, nestedScope.pyDeps);

	if (!manifest.rootHasPyManifest && !nestedScope) return null;
	if (deps.size === 0 && manifest.pyDeps.size > 0) return manifest.pyDeps;
	return deps;
};
