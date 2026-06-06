import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { type AislopConfig, findConfigDir, RULES_FILE } from "../config/index.js";
import { runEngines } from "../engines/orchestrator.js";
import type { EngineConfig, EngineName } from "../engines/types.js";
import { ENGINE_INFO, getEngineLabel } from "../output/engine-info.js";
import { printEngineStatus, renderDiagnostics } from "../output/terminal.js";
import { calculateScore } from "../scoring/index.js";
import { applyRuleSeverities } from "../scoring/rule-severity.js";
import { isCiEnv } from "../telemetry/env.js";
import { type EngineCounts, withCommandLifecycle } from "../telemetry/index.js";
import { renderHeader } from "../ui/header.js";
import { type GridRow, type GridRowOutcome, LiveGrid } from "../ui/live-grid.js";
import { log } from "../ui/logger.js";
import { discoverProject } from "../utils/discover.js";
import { baseRefExists, getChangedFiles, getStagedFiles } from "../utils/git.js";
import { appendHistory } from "../utils/history.js";
import {
	filterProjectFiles,
	listProjectFiles,
	readAislopIgnorePatterns,
} from "../utils/source-files.js";
import { applySuppressions } from "../utils/suppress.js";
import { APP_VERSION } from "../version.js";
import { renderCoverageNotice } from "./scan-coverage.js";
import { computeScanExitCode } from "./scan-exit-code.js";
import { buildScanRender } from "./scan-render.js";

export { buildScanRender } from "./scan-render.js";

interface ScanOptions {
	changes: boolean;
	staged: boolean;
	base?: string;
	verbose: boolean;
	json: boolean;
	sarif?: boolean;
	showHeader?: boolean;
	printBrand?: boolean;
	exclude?: string[];
	include?: string[];
	/** Used for telemetry to distinguish scan vs ci invocation */
	command?: "scan" | "ci";
}

// SARIF and JSON are machine outputs: suppress all human chrome on stdout.
const isMachineOutput = (options: ScanOptions): boolean =>
	Boolean(options.json) || Boolean(options.sarif);

const shouldUseSpinner = (): boolean =>
	Boolean(process.stderr.isTTY) && process.env.CI !== "true" && process.env.CI !== "1";

const ALL_ENGINE_NAMES = Object.keys(ENGINE_INFO) as EngineName[];

export const scanCommand = async (
	directory: string,
	config: AislopConfig,
	options: ScanOptions,
): Promise<{ exitCode: number }> => {
	const resolvedDir = path.resolve(directory);

	if (!fs.existsSync(resolvedDir)) {
		const msg = `Path does not exist: ${resolvedDir}`;
		if (options.json) {
			console.log(JSON.stringify({ error: msg }, null, 2));
		} else {
			log.error(msg);
		}
		return { exitCode: 1 };
	}
	if (!fs.statSync(resolvedDir).isDirectory()) {
		const msg = `Not a directory: ${resolvedDir}`;
		if (options.json) {
			console.log(JSON.stringify({ error: msg }, null, 2));
		} else {
			log.error(msg);
		}
		return { exitCode: 1 };
	}

	if (options.changes && options.base && !baseRefExists(resolvedDir, options.base)) {
		const msg = `Could not resolve base ref "${options.base}". Make sure it exists and was fetched (e.g. \`git fetch origin ${options.base}\`).`;
		if (options.json) {
			console.log(JSON.stringify({ error: msg }, null, 2));
		} else {
			log.error(msg);
		}
		return { exitCode: 1 };
	}

	const excludePatterns = [...config.exclude, ...readAislopIgnorePatterns(resolvedDir)];
	const projectInfo = await discoverProject(resolvedDir, excludePatterns);

	return withCommandLifecycle(
		{
			command: options.command ?? "scan",
			config: config.telemetry,
			languages: projectInfo.languages,
			fileCount: projectInfo.sourceFileCount,
		},
		() => runScanBody(resolvedDir, config, options, projectInfo),
	);
};

const runScanBody = async (
	resolvedDir: string,
	config: AislopConfig,
	options: ScanOptions,
	projectInfo: Awaited<ReturnType<typeof discoverProject>>,
) => {
	const startTime = performance.now();
	const showHeader = options.showHeader !== false;
	const machineOutput = isMachineOutput(options);
	const useLiveProgress = !machineOutput && shouldUseSpinner();
	const projectName = projectInfo.projectName ?? "project";
	const language = projectInfo.languages[0] ?? "unknown";
	const printedHumanHeader = !machineOutput && showHeader;

	if (printedHumanHeader) {
		process.stdout.write(
			renderHeader({
				version: APP_VERSION,
				command: "Scan result",
				context: [projectName, language, `${projectInfo.sourceFileCount} files`],
				brand: options.printBrand !== false,
			}),
		);
	}

	const excludePatterns = [...config.exclude, ...readAislopIgnorePatterns(resolvedDir)];

	let files: string[] | undefined;
	if (options.staged) {
		files = filterProjectFiles(resolvedDir, getStagedFiles(resolvedDir), [], excludePatterns);
		if (!machineOutput) {
			log.muted(`Scope: ${files.length} staged file(s)`);
		}
	} else if (options.changes) {
		files = filterProjectFiles(
			resolvedDir,
			getChangedFiles(resolvedDir, options.base),
			[],
			excludePatterns,
		);
		if (!machineOutput) {
			const scope = options.base ? `changed vs ${options.base}` : "changed";
			log.muted(`Scope: ${files.length} ${scope} file(s)`);
		}
	} else {
		const allFiles = listProjectFiles(resolvedDir);
		files = filterProjectFiles(resolvedDir, allFiles, [], excludePatterns);
		if (!machineOutput) {
			log.muted(`Scope: ${files.length} file(s) after exclusions`);
		}
	}

	const configDir = findConfigDir(resolvedDir);
	const rulesPath = configDir ? path.join(configDir, RULES_FILE) : undefined;

	const engineConfig: EngineConfig = {
		quality: config.quality,
		security: config.security,
		lint: config.lint,
		architectureRulesPath: config.engines.architecture ? rulesPath : undefined,
	};

	const enabledEngines = ALL_ENGINE_NAMES.filter((engine) => config.engines[engine] !== false);
	const gridRows: GridRow[] = enabledEngines.map((engine) => ({
		label: getEngineLabel(engine),
		status: "queued",
		key: engine,
	}));
	const progressRenderer = useLiveProgress ? new LiveGrid(gridRows) : null;

	progressRenderer?.start();

	const rawResults = await runEngines(
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
			progressRenderer?.update(engine, { status: "running" });
		},
		(result) => {
			if (result.skipped) {
				progressRenderer?.update(result.engine, { status: "skipped", summary: "skipped" });
			} else {
				const errors = result.diagnostics.filter((d) => d.severity === "error").length;
				const warnings = result.diagnostics.filter((d) => d.severity === "warning").length;
				let outcome: GridRowOutcome = "ok";
				let summary = "0 issues";
				if (errors > 0) {
					outcome = "fail";
					summary = `${errors} error${errors === 1 ? "" : "s"}`;
				} else if (warnings > 0) {
					outcome = "warn";
					summary = `${warnings} warning${warnings === 1 ? "" : "s"}`;
				}
				progressRenderer?.update(result.engine, {
					status: "done",
					outcome,
					summary,
					elapsedMs: result.elapsed,
				});
			}
			if (!machineOutput && !progressRenderer) {
				printEngineStatus(result);
			}
		},
	);
	progressRenderer?.stop();

	const severityAdjusted = rawResults.map((result) => ({
		...result,
		diagnostics: applyRuleSeverities(result.diagnostics, config.rules),
	}));
	const { results, suppressedCount } = applySuppressions(severityAdjusted, resolvedDir);
	if (suppressedCount > 0 && !machineOutput) {
		log.muted(`Suppressed ${suppressedCount} finding(s) via aislop-ignore directives`);
	}

	const allDiagnostics = results.flatMap((r) => r.diagnostics);
	const elapsedMs = performance.now() - startTime;

	const scoreResult = calculateScore(
		allDiagnostics,
		config.scoring.weights,
		config.scoring.thresholds,
		projectInfo.sourceFileCount,
		config.scoring.smoothing,
		config.scoring.maxPerRule,
	);
	const scoreable = projectInfo.coverage.scoreable;
	const hasErrors = allDiagnostics.some((d) => d.severity === "error");
	const exitCode = computeScanExitCode({
		hasErrors,
		scoreable,
		score: scoreResult.score,
		failBelow: config.ci.failBelow,
	});

	const engineIssues: EngineCounts = {};
	const engineTimings: EngineCounts = {};
	for (const r of results) {
		engineIssues[r.engine] = r.diagnostics.length;
		engineTimings[r.engine] = Math.round(r.elapsed);
	}
	const completion = {
		exitCode,
		score: scoreable ? scoreResult.score : null,
		scoreable,
		findingCount: allDiagnostics.length,
		errorCount: allDiagnostics.filter((d) => d.severity === "error").length,
		warningCount: allDiagnostics.filter((d) => d.severity === "warning").length,
		fixableCount: allDiagnostics.filter((d) => d.fixable).length,
		engineIssues,
		engineTimings,
	};

	if (options.sarif) {
		const { buildSarifLog } = await import("../output/sarif.js");
		console.log(JSON.stringify(buildSarifLog(results), null, 2));
		return completion;
	}

	if (options.json) {
		const { buildJsonOutput } = await import("../output/json.js");
		const jsonOut = buildJsonOutput(
			results,
			scoreResult,
			projectInfo.sourceFileCount,
			elapsedMs,
			projectInfo.coverage,
		);
		console.log(JSON.stringify(jsonOut, null, 2));
		return completion;
	}

	if (!scoreable) {
		if (!machineOutput) {
			process.stdout.write(renderCoverageNotice(projectInfo, !printedHumanHeader && showHeader));
			// Score is withheld, but findings still ran on the supported files; show them so a CI failure on an error diagnostic is explained.
			if (allDiagnostics.length > 0) {
				process.stdout.write(renderDiagnostics(allDiagnostics, options.verbose ?? false));
			}
		}
		return completion;
	}

	// Only record full-project human scans: scoped (--staged/--changes) scores
	// aren't comparable across runs, and CI runs would pollute local trends.
	const isFullScopeScan = !options.staged && !options.changes && options.command !== "ci";
	if (isFullScopeScan && !isCiEnv()) {
		appendHistory({
			directory: resolvedDir,
			score: scoreResult.score,
			errors: completion.errorCount,
			warnings: completion.warningCount,
			files: projectInfo.sourceFileCount,
		});
	}

	process.stdout.write(
		buildScanRender({
			projectName,
			language,
			fileCount: projectInfo.sourceFileCount,
			results,
			diagnostics: allDiagnostics,
			score: scoreResult,
			elapsedMs,
			thresholds: config.scoring.thresholds,
			verbose: options.verbose,
			includeHeader: !printedHumanHeader && showHeader,
			printBrand: options.printBrand,
		}),
	);

	return completion;
};
