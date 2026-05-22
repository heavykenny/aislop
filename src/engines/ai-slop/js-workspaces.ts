import fs from "node:fs";
import path from "node:path";

const readJson = (filePath: string): unknown => {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
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
	const lerna = readJson(path.join(rootDir, "lerna.json")) as Record<string, unknown> | null;
	if (lerna && Array.isArray(lerna.packages)) {
		for (const g of lerna.packages) if (typeof g === "string") globs.push(g);
	}
	try {
		const pnpmWs = fs.readFileSync(path.join(rootDir, "pnpm-workspace.yaml"), "utf-8");
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

const expandWorkspaceDirs = (rootDir: string, globs: string[]): string[] => {
	const dirs: string[] = [];
	for (const glob of globs) {
		if (glob.endsWith("/*")) {
			const parent = path.join(rootDir, glob.slice(0, -2));
			try {
				for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
					if (entry.isDirectory()) dirs.push(path.join(parent, entry.name));
				}
			} catch {
				continue;
			}
		} else if (!glob.includes("*")) {
			dirs.push(path.join(rootDir, glob));
		}
	}
	return dirs;
};

export const collectWorkspaceDirs = (rootDir: string, rootPkg: unknown): string[] =>
	expandWorkspaceDirs(rootDir, readWorkspaceGlobs(rootDir, rootPkg));
