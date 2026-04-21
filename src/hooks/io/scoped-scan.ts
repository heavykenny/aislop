import fs from "node:fs";
import path from "node:path";
import { findConfigDir, loadConfig, RULES_FILE } from "../../config/index.js";
import { runEngines } from "../../engines/orchestrator.js";
import type { Diagnostic, EngineContext, EngineName } from "../../engines/types.js";
import { calculateScore } from "../../scoring/index.js";
import { discoverProject } from "../../utils/discover.js";
import { getChangedFiles } from "../../utils/git.js";
import { filterProjectFiles } from "../../utils/source-files.js";

interface ScopedScanResult {
	diagnostics: Diagnostic[];
	score: number;
	rootDirectory: string;
}

const existingAbsolutePaths = (cwd: string, files: string[]): string[] =>
	files
		.map((f) => (path.isAbsolute(f) ? f : path.join(cwd, f)))
		.filter((p) => {
			try {
				return fs.statSync(p).isFile();
			} catch {
				return false;
			}
		});

export const resolveHookFiles = (cwd: string, files: string[]): string[] => {
	const direct = existingAbsolutePaths(cwd, files);
	if (direct.length > 0) return direct;
	return existingAbsolutePaths(cwd, getChangedFiles(cwd));
};

export const runScopedScan = async (
	cwd: string,
	filePaths: string[],
): Promise<ScopedScanResult> => {
	const project = await discoverProject(cwd);
	const config = loadConfig(cwd);
	const configDir = findConfigDir(project.rootDirectory);
	const rulesPath = configDir ? path.join(configDir, RULES_FILE) : undefined;

	const context: EngineContext = {
		rootDirectory: project.rootDirectory,
		languages: project.languages,
		frameworks: project.frameworks,
		files: filterProjectFiles(project.rootDirectory, filePaths),
		installedTools: project.installedTools,
		config: {
			quality: config.quality,
			// Network-bound audit exceeds every agent's hook timeout, so always off here.
			security: { audit: false, auditTimeout: 0 },
			architectureRulesPath: config.engines.architecture ? rulesPath : undefined,
		},
	};

	const enabled: Record<EngineName, boolean> = {
		format: config.engines.format,
		lint: config.engines.lint,
		"code-quality": config.engines["code-quality"],
		"ai-slop": config.engines["ai-slop"],
		architecture: config.engines.architecture,
		security: false,
	};

	const results = await runEngines(context, enabled);
	const diagnostics = results.flatMap((r) => r.diagnostics);
	const { score } = calculateScore(
		diagnostics,
		config.scoring.weights,
		config.scoring.thresholds,
		project.sourceFileCount,
		config.scoring.smoothing,
	);

	return { diagnostics, score, rootDirectory: project.rootDirectory };
};
