import fs from "node:fs";
import path from "node:path";
import { isGeneratedArtifactFile } from "./generated-files.js";

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

export const EXCLUDED_SOURCE_DIRECTORIES = [
	"node_modules",
	"dist",
	"build",
	".git",
	".agents",
	".pnpm-store",
	".yarn",
	"bower",
	"bower_components",
	"jspm_packages",
	"schemaspy",
	"generated",
	"__generated__",
	"auto-generated",
	"vendor",
	"vendors",
	"_vendor",
	"vendored",
	"third_party",
	"third-party",
	"3rdparty",
	"examples",
	"example",
	"demos",
	"demo",
	"bench",
	"benches",
	"benchmarks",
	"fixtures",
	"fixture",
	"stories",
	"story",
	"storybook",
	"__stories__",
	"samples",
	"sample",
	"tutorials",
	"tutorial",
	"code_samples",
	"code-samples",
	"notebooks",
	"tests",
	"test",
	"testdata",
	"e2e",
	"__tests__",
	"__test__",
	"spec",
	"__mocks__",
	"test_data",
	".next",
	".nuxt",
	".wasp",
	"coverage",
	".turbo",
	"test-outputs",
	".bundle",
];

const NON_PRUNED_TEST_DIRECTORIES = new Set([
	"tests",
	"test",
	"__tests__",
	"__test__",
	"spec",
	"__mocks__",
	"test_data",
	"e2e",
]);

export const TEST_EXCLUDED_DIRECTORIES = EXCLUDED_SOURCE_DIRECTORIES.filter(
	(directory) => !NON_PRUNED_TEST_DIRECTORIES.has(directory),
);

export const WALK_PRUNE_DIRECTORIES = new Set([
	"node_modules",
	".git",
	".pnpm-store",
	".yarn",
	"dist",
	"build",
	"out",
	"coverage",
	"vendor",
	"vendors",
	"third_party",
	"third-party",
]);

const TEST_FILE_PATTERNS = [
	/(?:^|\/).*\.test\.[^/]+$/i,
	/(?:^|\/).*\.spec\.[^/]+$/i,
	/(?:^|\/).*\.stor(?:y|ies)\.[^/]+$/i,
	/(?:^|\/)test_[^/]+\.(?:py|rb|php|js|jsx|d\.ts|ts|tsx|java)$/i,
	/(?:^|\/)[^/]+_test\.(?:py|go|rb|php|js|jsx|d\.ts|ts|tsx|java)$/i,
];

export const toProjectPath = (rootDirectory: string, filePath: string): string => {
	const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(rootDirectory, filePath);
	return path.relative(rootDirectory, absolutePath).split(path.sep).join("/");
};

export const isWithinProject = (relativePath: string): boolean =>
	relativePath.length > 0 && !relativePath.startsWith("..");

export const isSafeRegularProjectFile = (rootDirectory: string, absolutePath: string): boolean => {
	try {
		const stat = fs.lstatSync(absolutePath);
		if (!stat.isFile()) return false;
		const realRoot = fs.realpathSync(rootDirectory);
		const realFile = fs.realpathSync(absolutePath);
		const relativePath = path.relative(realRoot, realFile);
		return isWithinProject(relativePath) && !path.isAbsolute(relativePath);
	} catch {
		return false;
	}
};

export const hasAllowedSourceExtension = (
	filePath: string,
	extraExtensions: ReadonlySet<string>,
): boolean =>
	SOURCE_EXTENSIONS.has(path.extname(filePath)) || extraExtensions.has(path.extname(filePath));

export const isInExcludedDirectory = (
	filePath: string,
	excludedDirectories: readonly string[],
): boolean => {
	const normalized = filePath.toLowerCase();
	return excludedDirectories.some(
		(directory) =>
			normalized === directory ||
			normalized.startsWith(`${directory}/`) ||
			normalized.includes(`/${directory}/`),
	);
};

export const isExcludedFromScan = (relativePath: string): boolean =>
	isInExcludedDirectory(relativePath, EXCLUDED_SOURCE_DIRECTORIES) ||
	isGeneratedArtifactFile(relativePath);

export const isTestFile = (filePath: string): boolean =>
	TEST_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
