import fs from "node:fs";
import path from "node:path";
import { safeProjectDirectoryPath, safeProjectFilePath } from "../../utils/project-path-safety.js";

const readJson = (filePath: string, rootDirectory: string): unknown => {
	try {
		const safePath = safeProjectFilePath(filePath, rootDirectory);
		return safePath ? JSON.parse(fs.readFileSync(safePath, "utf-8")) : null;
	} catch {
		return null;
	}
};

const readWorkspaceGlobs = (rootDir: string, rootPkg: unknown): string[] => {
	const globs: string[] = [];
	if (rootPkg && typeof rootPkg === "object") {
		const ws = (rootPkg as Record<string, unknown>).workspaces;
		if (Array.isArray(ws)) {
			for (const g of ws) if (typeof g === "string") globs.push(g);
		} else if (ws && typeof ws === "object") {
			const pkgs = (ws as Record<string, unknown>).packages;
			if (Array.isArray(pkgs)) {
				for (const g of pkgs) if (typeof g === "string") globs.push(g);
			}
		}
	}
	const lerna = readJson(path.join(rootDir, "lerna.json"), rootDir) as Record<
		string,
		unknown
	> | null;
	if (lerna && Array.isArray(lerna.packages)) {
		for (const g of lerna.packages) if (typeof g === "string") globs.push(g);
	}
	try {
		const pnpmPath = safeProjectFilePath(path.join(rootDir, "pnpm-workspace.yaml"), rootDir);
		if (!pnpmPath) return globs;
		const pnpmWs = fs.readFileSync(pnpmPath, "utf-8");
		let inPackages = false;
		for (const rawLine of pnpmWs.split("\n")) {
			if (/^packages\s*:\s*$/.test(rawLine)) {
				inPackages = true;
				continue;
			}
			if (!inPackages) continue;
			if (/^\S/.test(rawLine)) break;
			const m = rawLine.match(/^\s*-\s*["']?([^"'\n]+?)["']?\s*$/);
			if (m) globs.push(m[1].trim());
		}
	} catch {
		return globs;
	}
	return globs;
};

const readWorkspaceEntries = (dir: string): fs.Dirent[] => {
	try {
		return fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
};

const expandWorkspaceDirs = (rootDir: string, globs: string[]): string[] => {
	const dirs: string[] = [];
	let rootDirectory: string;
	try {
		rootDirectory = fs.realpathSync(rootDir);
	} catch {
		return dirs;
	}
	for (const glob of globs) {
		if (glob.endsWith("/*")) {
			const parent = safeProjectDirectoryPath(
				path.resolve(rootDirectory, glob.slice(0, -2)),
				rootDirectory,
			);
			if (!parent) continue;
			for (const entry of readWorkspaceEntries(parent)) {
				if (!entry.isDirectory()) continue;
				const directory = safeProjectDirectoryPath(path.join(parent, entry.name), rootDirectory);
				if (directory) dirs.push(directory);
			}
		} else if (!glob.includes("*")) {
			const directory = safeProjectDirectoryPath(path.resolve(rootDirectory, glob), rootDirectory);
			if (directory) dirs.push(directory);
		}
	}
	return dirs;
};

export const collectWorkspaceDirs = (rootDir: string, rootPkg: unknown): string[] =>
	expandWorkspaceDirs(rootDir, readWorkspaceGlobs(rootDir, rootPkg));
