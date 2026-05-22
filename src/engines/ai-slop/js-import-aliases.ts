import fs from "node:fs";
import path from "node:path";

export type AliasMatcher = (spec: string) => boolean;

const TS_CONFIG_FILES = ["tsconfig.json", "jsconfig.json"];
const JS_RESOLUTION_EXTENSIONS = [
	"",
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
	"/index.ts",
	"/index.tsx",
	"/index.js",
	"/index.jsx",
];

const readJson = (filePath: string): unknown => {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return null;
	}
};

const buildAliasMatcher = (key: string): AliasMatcher => {
	const starIdx = key.indexOf("*");
	if (starIdx === -1) {
		return (spec) => spec === key;
	}
	const before = key.slice(0, starIdx);
	const after = key.slice(starIdx + 1);
	return (spec) =>
		spec.length >= before.length + after.length && spec.startsWith(before) && spec.endsWith(after);
};

const collectAliasMatchersFromConfig = (configPath: string, matchers: AliasMatcher[]): void => {
	const config = readJson(configPath) as Record<string, unknown> | null;
	const opts = config?.compilerOptions;
	if (!opts || typeof opts !== "object") return;
	const configDir = path.dirname(configPath);
	const paths = (opts as Record<string, unknown>).paths;
	if (paths && typeof paths === "object") {
		for (const key of Object.keys(paths as Record<string, unknown>)) {
			matchers.push(buildAliasMatcher(key));
		}
	}

	const baseUrl = (opts as Record<string, unknown>).baseUrl;
	if (typeof baseUrl === "string") {
		const baseDir = path.resolve(configDir, baseUrl);
		matchers.push((spec) => {
			if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@")) return false;
			return JS_RESOLUTION_EXTENSIONS.some((suffix) =>
				fs.existsSync(path.join(baseDir, `${spec}${suffix}`)),
			);
		});
	}
};

export const collectTsPathAliases = (rootDir: string, workspaceDirs: string[]): AliasMatcher[] => {
	const matchers: AliasMatcher[] = [];
	const dirs = [rootDir, ...workspaceDirs];
	for (const dir of dirs) {
		for (const fname of TS_CONFIG_FILES) {
			collectAliasMatchersFromConfig(path.join(dir, fname), matchers);
		}
	}
	return matchers;
};
