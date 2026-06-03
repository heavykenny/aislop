import fs from "node:fs";
import path from "node:path";
import { listProjectFiles } from "../../utils/source-files.js";

const readTextFile = (filePath: string): string | null => {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
};

const collectPackageNames = (dir: string): Set<string> => {
	const names = new Set<string>();
	const raw = readTextFile(path.join(dir, "package.json"));
	if (!raw) return names;

	try {
		const pkg = JSON.parse(raw) as Record<string, Record<string, string> | string>;
		for (const section of [
			"dependencies",
			"devDependencies",
			"peerDependencies",
			"optionalDependencies",
		]) {
			const deps = pkg[section];
			if (deps && typeof deps === "object") {
				for (const name of Object.keys(deps)) names.add(name);
			}
		}
	} catch {
		return names;
	}

	return names;
};

const readJson = (filePath: string): Record<string, unknown> | null => {
	const raw = readTextFile(filePath);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
};

const hasBunRuntime = (rootDir: string, projectFiles: string[]): boolean => {
	if (
		fs.existsSync(path.join(rootDir, "bun.lock")) ||
		fs.existsSync(path.join(rootDir, "bun.lockb")) ||
		fs.existsSync(path.join(rootDir, "bunfig.toml"))
	) {
		return true;
	}
	const hasBunFiles = projectFiles.some((filePath) =>
		/(?:^|\/)bunfig\.toml$|(?:^|\/)bun\.lockb?$/.test(filePath),
	);

	const pkg = readJson(path.join(rootDir, "package.json"));
	if (!pkg) return hasBunFiles;
	if (typeof pkg.packageManager === "string" && /^bun@/i.test(pkg.packageManager)) return true;

	const scripts = pkg.scripts;
	if (scripts && typeof scripts === "object") {
		for (const command of Object.values(scripts as Record<string, unknown>)) {
			if (typeof command === "string" && /(?:^|[;&|()\s])bunx?\s/.test(command)) return true;
		}
	}

	return hasBunFiles;
};

const hasDenoRuntime = (rootDir: string, projectFiles: string[]): boolean => {
	if (
		fs.existsSync(path.join(rootDir, "deno.json")) ||
		fs.existsSync(path.join(rootDir, "deno.jsonc"))
	) {
		return true;
	}
	return projectFiles.some((filePath) => /(?:^|\/)deno\.jsonc?$/.test(filePath));
};

const AMBIENT_GLOBAL_RE =
	/^\s*(?:declare\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

export const collectAmbientGlobals = (rootDir: string): string[] => {
	const globals = new Set<string>();
	const projectFiles = listProjectFiles(rootDir);

	for (const relativePath of projectFiles) {
		if (!relativePath.endsWith(".d.ts")) continue;
		const content = readTextFile(path.join(rootDir, relativePath));
		if (!content) continue;

		for (const match of content.matchAll(AMBIENT_GLOBAL_RE)) {
			globals.add(match[1]);
		}
	}

	const deps = collectPackageNames(rootDir);
	if (deps.has("@types/bun") || deps.has("bun-types") || hasBunRuntime(rootDir, projectFiles)) {
		globals.add("Bun");
	}
	if (hasDenoRuntime(rootDir, projectFiles)) globals.add("Deno");

	if (projectFiles.some((filePath) => /(?:^|\/)sst\.config\.ts$/.test(filePath))) {
		for (const name of [
			"$app",
			"$config",
			"$dev",
			"$interpolate",
			"$resolve",
			"$jsonParse",
			"$jsonStringify",
			"aws",
			"cloudflare",
			"docker",
			"random",
			"sst",
			"vercel",
			"pulumi",
		]) {
			globals.add(name);
		}
	}

	return [...globals];
};
