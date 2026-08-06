import path from "node:path";
import {
	detectFrameworks,
	detectLanguages,
	type Framework,
	type Language,
	readPackageJson,
} from "./discovery-classifiers.js";
import { analyzeCoverage, type Coverage } from "./discovery-coverage.js";
import { checkInstalledTools } from "./discovery-tools.js";
import { resetGitIgnoreSnapshots } from "./git-ignore.js";
import { getSourceFilesForRoot } from "./source-files.js";

export type { Framework, Language } from "./discovery-classifiers.js";
export { detectSourceLanguages } from "./discovery-classifiers.js";
export type { Coverage } from "./discovery-coverage.js";
export { TOOLS_TO_CHECK } from "./discovery-tools.js";

export interface ProjectInfo {
	rootDirectory: string;
	projectName: string;
	languages: Language[];
	frameworks: Framework[];
	sourceFileCount: number;
	coverage: Coverage;
	installedTools: Record<string, boolean>;
}

interface DiscoveryInputs {
	readonly includePatterns?: string[];
	readonly installedTools?: Record<string, boolean>;
	readonly projectFiles?: string[];
	readonly sourceFiles?: string[];
}

export const discoverProject = async (
	directory: string,
	excludePatterns: string[] = [],
	inputs: DiscoveryInputs = {},
): Promise<ProjectInfo> => {
	const resolvedDir = path.resolve(directory);
	// Every scan flavor calls discoverProject once, so discovery and its engines
	// share one fresh gitignore snapshot while long-lived processes cannot reuse
	// a stale snapshot from an earlier scan.
	resetGitIgnoreSnapshots();
	const sourceFiles = inputs.sourceFiles ?? getSourceFilesForRoot(resolvedDir);
	const coverage = analyzeCoverage(resolvedDir, {
		excludePatterns,
		includePatterns: inputs.includePatterns ?? [],
		...(inputs.projectFiles ? { projectFiles: inputs.projectFiles } : {}),
	});
	const installedTools = inputs.installedTools ?? (await checkInstalledTools());
	const packageJson = readPackageJson(path.join(resolvedDir, "package.json"));
	return {
		rootDirectory: resolvedDir,
		projectName: packageJson?.name ?? path.basename(resolvedDir),
		languages: detectLanguages(resolvedDir, sourceFiles),
		frameworks: detectFrameworks(resolvedDir),
		sourceFileCount: sourceFiles.length,
		coverage,
		installedTools,
	};
};
