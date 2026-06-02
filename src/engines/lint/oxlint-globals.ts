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
	if (deps.has("@types/bun") || deps.has("bun-types")) globals.add("Bun");

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
