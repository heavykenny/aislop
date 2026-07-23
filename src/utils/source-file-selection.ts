import path from "node:path";
import micromatch from "micromatch";
import { isGeneratedArtifactFile } from "./generated-files.js";
import { getIgnoredPaths } from "./git-ignore.js";
import { enumerateProjectFiles, enumerateProjectFilesFromDisk } from "./project-file-list.js";
import {
	EXCLUDED_SOURCE_DIRECTORIES,
	hasAllowedSourceExtension,
	isInExcludedDirectory,
	isSafeRegularProjectFile,
	isTestFile,
	isWithinProject,
	TEST_EXCLUDED_DIRECTORIES,
	toProjectPath,
	WALK_PRUNE_DIRECTORIES,
} from "./source-file-policy.js";

const GENERATED_DECLARATION_DIRECTORIES = new Set(["generated", "__generated__", "auto-generated"]);
const DECLARATION_EXCLUDED_DIRECTORIES = EXCLUDED_SOURCE_DIRECTORIES.filter(
	(directory) => !GENERATED_DECLARATION_DIRECTORIES.has(directory),
);

export const listProjectFiles = (rootDirectory: string): string[] =>
	enumerateProjectFiles(rootDirectory, WALK_PRUNE_DIRECTORIES);

export const listProjectFilesFromDisk = (rootDirectory: string): string[] =>
	enumerateProjectFilesFromDisk(rootDirectory, WALK_PRUNE_DIRECTORIES);

const normalizeExcludePatterns = (patterns: string[]): string[] =>
	patterns.flatMap((pattern) => {
		const normalized = pattern.trim().replace(/^\.\//, "").replace(/\/+$/, "");
		if (normalized.length === 0) return [];
		if (micromatch.scan(normalized).isGlob) return [normalized];
		if (normalized.startsWith(".") && !normalized.includes("/")) {
			return [`**/*${normalized}`, `**/${normalized}/**`];
		}
		return [normalized, `${normalized}/**`];
	});

const normalizeIncludePatterns = (patterns: string[]): string[] =>
	patterns.flatMap((pattern) => {
		const normalized = pattern.trim().replace(/^\.\//, "").replace(/\/$/, "");
		if (normalized === "" || normalized === ".") return ["**"];
		if (micromatch.scan(normalized).isGlob) return [normalized];
		return [normalized, `${normalized}/**`];
	});

interface FileFilterOptions {
	readonly exclude: string[];
	readonly extraExtensions: string[];
	readonly include: string[];
	readonly respectGitIgnore: boolean;
	readonly testFiles: boolean;
}

type ProjectFilterOptions = Omit<FileFilterOptions, "testFiles">;
type ProjectFileFilter = (
	rootDirectory: string,
	files: string[],
	extraExtensions?: string[],
	exclude?: string[],
	include?: string[],
) => string[];
type TestFileFilter = (
	rootDirectory: string,
	files: string[],
	exclude?: string[],
	include?: string[],
) => string[];

const filterFiles = (
	rootDirectory: string,
	files: string[],
	options: FileFilterOptions,
): string[] => {
	const extraExtensions = new Set(options.extraExtensions);
	const normalizedFiles = files
		.map((file) => {
			const absolutePath = path.isAbsolute(file) ? file : path.resolve(rootDirectory, file);
			return { absolutePath, relativePath: toProjectPath(rootDirectory, absolutePath) };
		})
		.filter(({ relativePath }) => isWithinProject(relativePath));
	const ignoredPaths = options.respectGitIgnore
		? getIgnoredPaths(
				rootDirectory,
				normalizedFiles.map(({ relativePath }) => relativePath),
			)
		: new Set<string>();
	const excludePatterns = normalizeExcludePatterns(options.exclude);
	const includePatterns = normalizeIncludePatterns(options.include);
	const excludedDirectories = options.testFiles
		? TEST_EXCLUDED_DIRECTORIES
		: EXCLUDED_SOURCE_DIRECTORIES;

	return normalizedFiles
		.filter(({ absolutePath, relativePath }) => {
			if (
				!isSafeRegularProjectFile(rootDirectory, absolutePath) ||
				isInExcludedDirectory(relativePath, excludedDirectories) ||
				isTestFile(relativePath) !== options.testFiles ||
				isGeneratedArtifactFile(relativePath) ||
				ignoredPaths.has(relativePath)
			) {
				return false;
			}
			if (
				includePatterns.length > 0 &&
				!micromatch.isMatch(relativePath, includePatterns, { dot: true })
			) {
				return false;
			}
			if (
				excludePatterns.length > 0 &&
				micromatch.isMatch(relativePath, excludePatterns, { dot: true })
			) {
				return false;
			}
			return hasAllowedSourceExtension(relativePath, extraExtensions);
		})
		.map(({ absolutePath }) => absolutePath);
};

const filterProjectFileSet = (
	rootDirectory: string,
	files: string[],
	options: ProjectFilterOptions,
): string[] => filterFiles(rootDirectory, files, { ...options, testFiles: false });

const filterTestFileSet = (
	rootDirectory: string,
	files: string[],
	options: Omit<ProjectFilterOptions, "extraExtensions">,
): string[] =>
	filterFiles(rootDirectory, files, { ...options, extraExtensions: [], testFiles: true });

const createProjectFileFilter =
	(respectGitIgnore: boolean): ProjectFileFilter =>
	(rootDirectory, files, extraExtensions = [], exclude = [], include = []) =>
		filterProjectFileSet(rootDirectory, files, {
			exclude,
			extraExtensions,
			include,
			respectGitIgnore,
		});

const createTestFileFilter =
	(respectGitIgnore: boolean): TestFileFilter =>
	(rootDirectory, files, exclude = [], include = []) =>
		filterTestFileSet(rootDirectory, files, { exclude, include, respectGitIgnore });

export const filterProjectFiles = createProjectFileFilter(true);
export const filterTestFiles = createTestFileFilter(true);
export const filterEnumeratedProjectFiles = createProjectFileFilter(false);
export const filterEnumeratedTestFiles = createTestFileFilter(false);

export const filterExplicitFiles = (
	rootDirectory: string,
	files: string[],
	extraExtensions: string[] = [],
): string[] => {
	const extensions = new Set(extraExtensions);
	return files
		.map((file) => {
			const absolutePath = path.isAbsolute(file) ? file : path.resolve(rootDirectory, file);
			return { absolutePath, relativePath: toProjectPath(rootDirectory, absolutePath) };
		})
		.filter(
			({ absolutePath, relativePath }) =>
				isWithinProject(relativePath) &&
				isSafeRegularProjectFile(rootDirectory, absolutePath) &&
				hasAllowedSourceExtension(relativePath, extensions),
		)
		.map(({ absolutePath }) => absolutePath);
};

export const filterProjectDeclarationFiles = (
	rootDirectory: string,
	files: string[],
	exclude: string[] = [],
	include: string[] = [],
): string[] => {
	const excludePatterns = normalizeExcludePatterns(exclude);
	const includePatterns = normalizeIncludePatterns(include);
	return filterExplicitFiles(rootDirectory, files).filter((filePath) => {
		if (!filePath.endsWith(".d.ts")) return false;
		const relativePath = toProjectPath(rootDirectory, filePath);
		if (
			isTestFile(relativePath) ||
			isInExcludedDirectory(relativePath, DECLARATION_EXCLUDED_DIRECTORIES)
		) {
			return false;
		}
		if (
			includePatterns.length > 0 &&
			!micromatch.isMatch(relativePath, includePatterns, { dot: true })
		) {
			return false;
		}
		return !(
			excludePatterns.length > 0 && micromatch.isMatch(relativePath, excludePatterns, { dot: true })
		);
	});
};
