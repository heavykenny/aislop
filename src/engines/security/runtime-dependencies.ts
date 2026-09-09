import fs from "node:fs";
import path from "node:path";
import micromatch from "micromatch";
import { parse as parseYaml } from "yaml";
import type { JsAuditManifest } from "./audit-js-parser.js";

const RUNTIME_DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];

// Deep enough for the nesting real monorepos use, shallow enough not to walk a whole tree.
const MAX_WORKSPACE_DEPTH = 5;

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next"]);

const readJsonFile = (filePath: string): Record<string, unknown> | undefined => {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		return parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
};

const collectRuntimeNames = (manifest: Record<string, unknown>, into: Set<string>): void => {
	for (const field of RUNTIME_DEPENDENCY_FIELDS) {
		const section = manifest[field];
		if (section && typeof section === "object") {
			for (const name of Object.keys(section)) into.add(name);
		}
	}
};

const asStringArray = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

// npm and yarn accept both `workspaces: []` and `workspaces: { packages: [] }`.
const npmWorkspaceGlobs = (manifest: Record<string, unknown>): string[] => {
	const workspaces = manifest.workspaces;
	if (Array.isArray(workspaces)) return asStringArray(workspaces);
	if (workspaces && typeof workspaces === "object") {
		return asStringArray((workspaces as Record<string, unknown>).packages);
	}
	return [];
};

const pnpmWorkspaceGlobs = (rootDir: string): string[] => {
	const configPath = path.join(rootDir, "pnpm-workspace.yaml");
	if (!fs.existsSync(configPath)) return [];
	try {
		const parsed: unknown = parseYaml(fs.readFileSync(configPath, "utf-8"));
		if (!parsed || typeof parsed !== "object") return [];
		return asStringArray((parsed as Record<string, unknown>).packages);
	} catch {
		return [];
	}
};

const listPackageDirectories = (rootDir: string): string[] => {
	const found: string[] = [];
	const walk = (directory: string, depth: number): void => {
		if (depth > MAX_WORKSPACE_DEPTH) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
			const child = path.join(directory, entry.name);
			found.push(path.relative(rootDir, child).split(path.sep).join("/"));
			walk(child, depth + 1);
		}
	};
	walk(rootDir, 1);
	return found;
};

/**
 * Runtime dependency names for the whole project, workspace members included.
 *
 * A vulnerability reachable only through a member's production dependency is still shipped,
 * so reading the root manifest alone would wrongly report it as dev-only. Returns undefined
 * when no manifest is readable, which leaves every advisory at full severity.
 */
export const readRuntimeDependencies = (rootDir: string): JsAuditManifest | undefined => {
	const rootManifest = readJsonFile(path.join(rootDir, "package.json"));
	if (!rootManifest) return undefined;

	const names = new Set<string>();
	collectRuntimeNames(rootManifest, names);

	const globs = [...npmWorkspaceGlobs(rootManifest), ...pnpmWorkspaceGlobs(rootDir)];
	if (globs.length === 0) return { runtimeDependencies: names };

	for (const relativeDir of micromatch(listPackageDirectories(rootDir), globs)) {
		const memberManifest = readJsonFile(path.join(rootDir, relativeDir, "package.json"));
		if (memberManifest) collectRuntimeNames(memberManifest, names);
	}

	return { runtimeDependencies: names };
};
