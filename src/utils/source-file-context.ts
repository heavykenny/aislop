import type { EngineContext } from "../engines/types.js";
import {
	filterEnumeratedTestFiles,
	filterExplicitFiles,
	filterProjectDeclarationFiles,
	filterProjectFiles,
	filterTestFiles,
	listProjectFiles,
} from "./source-file-selection.js";

export const getSourceFilesForRoot = (rootDirectory: string): string[] =>
	filterProjectFiles(rootDirectory, listProjectFiles(rootDirectory));

const getTestFilesForRoot = (rootDirectory: string): string[] =>
	filterTestFiles(rootDirectory, listProjectFiles(rootDirectory));

export const getSourceFiles = (context: EngineContext): string[] =>
	context.files
		? filterExplicitFiles(context.rootDirectory, context.files)
		: getSourceFilesForRoot(context.rootDirectory);

export const getProjectSourceFiles = (context: EngineContext): string[] => {
	if (context.projectFiles) {
		return filterExplicitFiles(context.rootDirectory, context.projectFiles);
	}
	const candidates = listProjectFiles(context.rootDirectory);
	if (context.files && context.files.length > 0) {
		return [
			...getSourceFilesForRoot(context.rootDirectory),
			...filterProjectDeclarationFiles(context.rootDirectory, candidates),
		];
	}
	return [
		...getSourceFiles(context),
		...filterProjectDeclarationFiles(context.rootDirectory, candidates),
	];
};

export const getTestFiles = (context: EngineContext): string[] => {
	if (context.testFiles) {
		return filterEnumeratedTestFiles(context.rootDirectory, context.testFiles);
	}
	if (context.files) return filterTestFiles(context.rootDirectory, context.files);
	return getTestFilesForRoot(context.rootDirectory);
};

export const getSourceFilesWithExtras = (
	context: EngineContext,
	extraExtensions: string[],
): string[] =>
	context.files
		? filterExplicitFiles(context.rootDirectory, context.files, extraExtensions)
		: filterProjectFiles(
				context.rootDirectory,
				listProjectFiles(context.rootDirectory),
				extraExtensions,
			);
