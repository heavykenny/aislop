import path from "node:path";
import { performance } from "node:perf_hooks";
import type { AislopConfig } from "../config/index.js";
import { findConfigDir, RULES_FILE } from "../config/index.js";
import { runEngines } from "../engines/orchestrator.js";
import type { EngineConfig, EngineName } from "../engines/types.js";
import { ENGINE_INFO } from "../output/engine-info.js";
import {
	formatProjectSummary,
	printCommandHeader,
	printProjectMetadata,
} from "../output/layout.js";
import { printMaybePaged } from "../output/pager.js";
import { ScanProgressRenderer } from "../output/scan-progress.js";
import {
	printEngineStatus,
	renderDiagnostics,
	renderSummary,
} from "../output/terminal.js";
import { calculateScore } from "../scoring/index.js";
import { discoverProject } from "../utils/discover.js";
import { getChangedFiles, getStagedFiles } from "../utils/git.js";
import { highlighter } from "../utils/highlighter.js";
import { logger } from "../utils/logger.js";
import { filterProjectFiles } from "../utils/source-files.js";
import { spinner } from "../utils/spinner.js";
import {
	getScoreBucket,
	isTelemetryDisabled,
	trackEvent,
} from "../utils/telemetry.js";

interface ScanOptions {
	changes: boolean;
	staged: boolean;
	verbose: boolean;
	json: boolean;
	showHeader?: boolean;
	/** Used for telemetry to distinguish scan vs ci invocation */
	command?: "scan" | "ci";
}

const shouldUseSpinner = (): boolean =>
	Boolean(process.stderr.isTTY) &&
	process.env.CI !== "true" &&
	process.env.CI !== "1";

const ALL_ENGINE_NAMES = Object.keys(ENGINE_INFO) as EngineName[];

export const scanCommand = async (
	directory: string,
	config: AislopConfig,
	options: ScanOptions,
): Promise<{ exitCode: number }> => {
	const startTime = performance.now();
	const resolvedDir = path.resolve(directory);
	const showHeader = options.showHeader !== false;
	const useLiveProgress = !options.json && shouldUseSpinner();

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
		files = filterProjectFiles(resolvedDir, getStagedFiles(resolvedDir));
		if (!options.json) {
			logger.dim(`  Scope: ${files.length} staged file(s)`);
			logger.break();
		}
	} else if (options.changes) {
		files = filterProjectFiles(resolvedDir, getChangedFiles(resolvedDir));
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
	const progressRenderer = useLiveProgress
		? new ScanProgressRenderer(
				ALL_ENGINE_NAMES.filter((engine) => config.engines[engine] !== false),
			)
		: null;

	progressRenderer?.start();

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
		(engine) => {
			progressRenderer?.markStarted(engine);
		},
		(result) => {
			progressRenderer?.markComplete(result);
			if (!options.json && !progressRenderer) {
				printEngineStatus(result);
			}
		},
	);
	progressRenderer?.stop();

	const allDiagnostics = results.flatMap((r) => r.diagnostics);
	const elapsedMs = performance.now() - startTime;

	const scoreResult = calculateScore(
		allDiagnostics,
		config.scoring.weights,
		config.scoring.thresholds,
		projectInfo.sourceFileCount,
	);
	const hasErrors = allDiagnostics.some((d) => d.severity === "error");
	const exitCode = hasErrors || scoreResult.score < config.ci.failBelow ? 1 : 0;

	// Fire-and-forget anonymous telemetry (before output so it doesn't delay exit)
	if (!isTelemetryDisabled(config.telemetry?.enabled)) {
		const engineIssues: Record<string, number> = {};
		const engineTimings: Record<string, number> = {};
		for (const r of results) {
			engineIssues[r.engine] = r.diagnostics.length;
			engineTimings[r.engine] = Math.round(r.elapsed);
		}
		trackEvent({
			command: options.command ?? "scan",
			languages: projectInfo.languages,
			scoreBucket: getScoreBucket(scoreResult.score),
			engineIssues,
			engineTimings,
			elapsedMs: Math.round(elapsedMs),
			fileCount: projectInfo.sourceFileCount,
		});
	}

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

	const output = [
		"",
		allDiagnostics.length === 0
			? `${highlighter.success("  ✓ No issues found.")}\n`
			: renderDiagnostics(allDiagnostics, options.verbose),
		renderSummary(
			allDiagnostics,
			scoreResult,
			elapsedMs,
			projectInfo.sourceFileCount,
			config.scoring.thresholds,
		),
		"",
	].join("\n");

	await printMaybePaged(output);

	return { exitCode };
};
