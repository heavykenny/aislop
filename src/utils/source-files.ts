import { spawnSync } from "node:child_process";
import path from "node:path";
import type { EngineContext } from "../engines/types.js";

const SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".go",
	".rs",
	".rb",
	".java",
	".php",
]);

const EXCLUDED_DIRS = [
	"node_modules",
	"dist",
	"build",
	".git",
	"vendor",
	"tests",
	"test",
	"__tests__",
	"__test__",
	"spec",
	"__mocks__",
	"fixtures",
	"test_data",
	".next",
	".nuxt",
	"coverage",
	".turbo",
];

const isExcludedPath = (filePath: string): boolean =>
	EXCLUDED_DIRS.some(
		(dir) => filePath.includes(`/${dir}/`) || filePath.startsWith(`${dir}/`),
	);

const isSourceFile = (filePath: string): boolean =>
	SOURCE_EXTENSIONS.has(path.extname(filePath));

export const getSourceFiles = (context: EngineContext): string[] => {
	if (context.files) {
		return context.files.filter((f) => {
			const rel = path.relative(context.rootDirectory, f);
			return isSourceFile(f) && !isExcludedPath(rel);
		});
	}

	const result = spawnSync(
		"git",
		["ls-files", "--cached", "--others", "--exclude-standard"],
		{
			cwd: context.rootDirectory,
			encoding: "utf-8",
			maxBuffer: 50 * 1024 * 1024,
		},
	);

	if (result.error || result.status !== 0) return [];

	return result.stdout
		.split("\n")
		.filter((f) => f.length > 0 && isSourceFile(f) && !isExcludedPath(f))
		.map((f) => path.resolve(context.rootDirectory, f));
};

export const getSourceFilesWithExtras = (
	context: EngineContext,
	extraExtensions: string[],
): string[] => {
	const extraSet = new Set(extraExtensions);

	if (context.files) {
		return context.files.filter((f) => {
			const rel = path.relative(context.rootDirectory, f);
			return (
				(isSourceFile(f) || extraSet.has(path.extname(f))) &&
				!isExcludedPath(rel)
			);
		});
	}

	const result = spawnSync(
		"git",
		["ls-files", "--cached", "--others", "--exclude-standard"],
		{
			cwd: context.rootDirectory,
			encoding: "utf-8",
			maxBuffer: 50 * 1024 * 1024,
		},
	);

	if (result.error || result.status !== 0) return [];

	return result.stdout
		.split("\n")
		.filter(
			(f) =>
				f.length > 0 &&
				(isSourceFile(f) || extraSet.has(path.extname(f))) &&
				!isExcludedPath(f),
		)
		.map((f) => path.resolve(context.rootDirectory, f));
};
