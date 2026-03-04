import path from "node:path";
import { performance } from "node:perf_hooks";
import type { SlopConfig } from "../config/index.js";
import { findConfigDir, RULES_FILE } from "../config/index.js";
import { runEngines } from "../engines/orchestrator.js";
import type { EngineConfig } from "../engines/types.js";
import {
	formatProjectSummary,
	printCommandHeader,
	printProjectMetadata,
} from "../output/layout.js";
import {
	printDiagnostics,
	printEngineStatus,
	printSummary,
} from "../output/terminal.js";
import { calculateScore } from "../scoring/index.js";
import { discoverProject } from "../utils/discover.js";
import { getChangedFiles, getStagedFiles } from "../utils/git.js";
import { logger } from "../utils/logger.js";
import { spinner } from "../utils/spinner.js";

interface ScanOptions {
	changes: boolean;
	staged: boolean;
	verbose: boolean;
	json: boolean;
	showHeader?: boolean;
}

const shouldUseSpinner = (): boolean =>
	Boolean(process.stderr.isTTY) &&
	process.env.CI !== "true" &&
	process.env.CI !== "1";

export const scanCommand = async (
	directory: string,
	config: SlopConfig,
	options: ScanOptions,
): Promise<{ exitCode: number }> => {
	const startTime = performance.now();
	const resolvedDir = path.resolve(directory);
	const showHeader = options.showHeader !== false;

	if (!options.json && showHeader) {
		printCommandHeader("Scan");
	}

	const discoverSpinner =
		options.json || !shouldUseSpinner() || !showHeader
			? null
			: spinner("Discovering project...").start();
	const projectInfo = await discoverProject(resolvedDir);
	const projectSummary = formatProjectSummary(projectInfo);
	if (discoverSpinner) {
		discoverSpinner.succeed(projectSummary);
	} else if (!options.json) {
		logger.success(`  ✓ ${projectSummary}`);
	}

	if (!options.json) {
		printProjectMetadata(projectInfo);
	}

	let files: string[] | undefined;
	if (options.staged) {
		files = getStagedFiles(resolvedDir);
		if (!options.json) {
			logger.dim(`  Scope: ${files.length} staged file(s)`);
			logger.break();
		}
	} else if (options.changes) {
		files = getChangedFiles(resolvedDir);
		if (!options.json) {
			logger.dim(`  Scope: ${files.length} changed file(s)`);
			logger.break();
		}
	}

	const configDir = findConfigDir(resolvedDir);
	const rulesPath = configDir ? path.join(configDir, RULES_FILE) : undefined;

	const engineConfig: EngineConfig = {
		quality: config.quality,
		security: config.security,
		architectureRulesPath: config.engines.architecture ? rulesPath : undefined,
	};

	const results = await runEngines(
		{
			rootDirectory: resolvedDir,
			languages: projectInfo.languages,
			frameworks: projectInfo.frameworks,
			files,
			installedTools: projectInfo.installedTools,
			config: engineConfig,
		},
		config.engines,
		undefined,
		(result) => {
			if (!options.json) {
				printEngineStatus(result);
			}
		},
	);

	const allDiagnostics = results.flatMap((r) => r.diagnostics);
	const elapsedMs = performance.now() - startTime;

	const scoreResult = calculateScore(
		allDiagnostics,
		config.scoring.weights,
		config.scoring.thresholds,
	);
	const exitCode = scoreResult.score < config.ci.failBelow ? 1 : 0;

	if (options.json) {
		const { buildJsonOutput } = await import("../output/json.js");
		const jsonOut = buildJsonOutput(
			results,
			scoreResult,
			projectInfo.sourceFileCount,
			elapsedMs,
		);
		console.log(JSON.stringify(jsonOut, null, 2));
		return { exitCode };
	}

	logger.break();

	if (allDiagnostics.length === 0) {
		logger.success("  ✓ No issues found.");
		logger.break();
	} else {
		printDiagnostics(allDiagnostics, options.verbose);
	}

	printSummary(
		allDiagnostics,
		scoreResult,
		elapsedMs,
		projectInfo.sourceFileCount,
		config.scoring.thresholds,
	);
	logger.break();

	return { exitCode };
};
