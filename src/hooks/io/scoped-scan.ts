import fs from "node:fs";
import path from "node:path";
import { findConfigDir, loadConfig, RULES_FILE } from "../../config/index.js";
import { runEngines } from "../../engines/orchestrator.js";
import type { Diagnostic, EngineContext, EngineName } from "../../engines/types.js";
import { calculateScore } from "../../scoring/index.js";
import { applyRuleSeverities } from "../../scoring/rule-severity.js";
import { discoverProject } from "../../utils/discover.js";
import {
	filterEnumeratedProjectFiles,
	filterEnumeratedTestFiles,
	filterProjectDeclarationFiles,
	listProjectFilesFromDisk,
	readAislopIgnorePatterns,
} from "../../utils/source-files.js";

interface ScopedScanResult {
	diagnostics: Diagnostic[];
	score: number;
	rootDirectory: string;
}

const isWithinDirectory = (rootDirectory: string, candidate: string): boolean => {
	const relative = path.relative(rootDirectory, candidate);
	return (
		relative === "" ||
		(!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
	);
};

const existingAbsolutePaths = (cwd: string, files: string[]): string[] => {
	try {
		const absoluteRoot = path.resolve(cwd);
		const realRoot = fs.realpathSync(cwd);
		return files.flatMap((filePath) => {
			const absolutePath = path.resolve(cwd, filePath);
			if (!isWithinDirectory(absoluteRoot, absolutePath)) return [];

			try {
				if (!fs.statSync(absolutePath).isFile()) return [];
				const realPath = fs.realpathSync(absolutePath);
				return isWithinDirectory(realRoot, realPath) ? [absolutePath] : [];
			} catch {
				return [];
			}
		});
	} catch {
		return [];
	}
};

export const resolveHookFiles = (cwd: string, files: string[]): string[] => {
	return existingAbsolutePaths(cwd, files);
};

export const runScopedScan = async (
	cwd: string,
	filePaths: string[],
): Promise<ScopedScanResult> => {
	const rootDirectory = path.resolve(cwd);
	const config = loadConfig(rootDirectory);
	const excludePatterns = [...config.exclude, ...readAislopIgnorePatterns(rootDirectory)];
	const projectCandidates = listProjectFilesFromDisk(rootDirectory);
	const projectSourceFiles = filterEnumeratedProjectFiles(
		rootDirectory,
		projectCandidates,
		[],
		excludePatterns,
		config.include,
	);
	const projectTestFiles = filterEnumeratedTestFiles(
		rootDirectory,
		projectCandidates,
		excludePatterns,
		config.include,
	);
	const project = await discoverProject(rootDirectory, excludePatterns, {
		installedTools: {},
		projectFiles: projectCandidates,
		sourceFiles: projectSourceFiles,
	});
	const configDir = findConfigDir(rootDirectory);
	const rulesPath = configDir ? path.join(configDir, RULES_FILE) : undefined;
	const enumeratedPaths = new Set(
		projectCandidates.map((filePath) => path.resolve(rootDirectory, filePath)),
	);
	const scopedCandidates = filePaths.filter((filePath) =>
		enumeratedPaths.has(path.resolve(rootDirectory, filePath)),
	);

	const context: EngineContext = {
		rootDirectory: project.rootDirectory,
		languages: project.languages,
		frameworks: project.frameworks,
		files: filterEnumeratedProjectFiles(
			project.rootDirectory,
			scopedCandidates,
			[],
			excludePatterns,
			config.include,
		),
		testFiles: filterEnumeratedTestFiles(
			project.rootDirectory,
			scopedCandidates,
			excludePatterns,
			config.include,
		),
		projectFiles: [
			...new Set([
				...projectSourceFiles,
				...filterProjectDeclarationFiles(
					project.rootDirectory,
					projectCandidates,
					excludePatterns,
					config.include,
				),
			]),
		],
		installedTools: project.installedTools,
		config: {
			quality: config.quality,
			// Agent hooks run automatically when an editor changes a file. Keep this
			// path hook-safe: no network audits, no typecheck subprocesses, and no
			// execution-capable project-local tools.
			security: { audit: false, auditTimeout: 0 },
			lint: { typecheck: false, expoDoctor: false },
			allowProjectLocalTools: false,
			architectureRulesPath: config.engines.architecture ? rulesPath : undefined,
		},
	};

	const enabled: Record<EngineName, boolean> = {
		format: false,
		lint: false,
		"code-quality": config.engines["code-quality"],
		"ai-slop": config.engines["ai-slop"],
		architecture: config.engines.architecture,
		security: false,
	};

	const results = await runEngines(context, enabled);
	const diagnostics = applyRuleSeverities(
		results.flatMap((result) => result.diagnostics),
		config.rules,
	);
	const { score } = calculateScore(
		diagnostics,
		config.scoring.weights,
		config.scoring.thresholds,
		projectSourceFiles.length + projectTestFiles.length,
		config.scoring.smoothing,
		config.scoring.maxPerRule,
	);

	return { diagnostics, score, rootDirectory: project.rootDirectory };
};
