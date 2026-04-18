import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { AislopConfig } from "../config/index.js";
import { findConfigDir, RULES_FILE } from "../config/index.js";
import { runEngines } from "../engines/orchestrator.js";
import type { Diagnostic, EngineConfig, EngineName, EngineResult } from "../engines/types.js";
import { ENGINE_INFO, getEngineLabel } from "../output/engine-info.js";
import { printEngineStatus, renderDiagnostics } from "../output/terminal.js";
import { calculateScore } from "../scoring/index.js";
import { renderHeader } from "../ui/header.js";
import { detectInvocation } from "../ui/invocation.js";
import { type GridRow, type GridRowOutcome, LiveGrid } from "../ui/live-grid.js";
import { log } from "../ui/logger.js";
import { renderCleanRun, renderSummary, type NextStep } from "../ui/summary.js";
import { createSymbols } from "../ui/symbols.js";
import { createTheme } from "../ui/theme.js";
import { discoverProject } from "../utils/discover.js";
import { getChangedFiles, getStagedFiles } from "../utils/git.js";
import { filterProjectFiles } from "../utils/source-files.js";
import { getScoreBucket, isTelemetryDisabled, trackEvent } from "../utils/telemetry.js";
import { APP_VERSION } from "../version.js";

interface ScanOptions {
	changes: boolean;
	staged: boolean;
	verbose: boolean;
	json: boolean;
	showHeader?: boolean;
	printBrand?: boolean;
	/** Used for telemetry to distinguish scan vs ci invocation */
	command?: "scan" | "ci";
}

const shouldUseSpinner = (): boolean =>
	Boolean(process.stderr.isTTY) && process.env.CI !== "true" && process.env.CI !== "1";

const ALL_ENGINE_NAMES = Object.keys(ENGINE_INFO) as EngineName[];

interface BuildScanRenderInput {
	projectName: string;
	language: string;
	fileCount: number;
	results: EngineResult[];
	diagnostics: Diagnostic[];
	score: { score: number; label: string };
	elapsedMs: number;
	thresholds: { good: number; ok: number };
	verbose: boolean;
	includeHeader?: boolean;
	printBrand?: boolean;
}

export const buildScanRender = (input: BuildScanRenderInput): string => {
	// Render with TTY symbols + auto-detected theme so snapshots are deterministic.
	// Colors still reflect the terminal (they strip cleanly with ANSI_RE in tests).
	const deps = {
		theme: createTheme(),
		symbols: createSymbols({ plain: false }),
	};

	const invocation = detectInvocation();

	const header =
		input.includeHeader === false
			? ""
			: renderHeader(
					{
						version: APP_VERSION,
						command: "scan",
						context: [input.projectName, input.language, `${input.fileCount} files`],
						brand: input.printBrand !== false,
					},
					deps,
				);

	const errors = input.diagnostics.filter((d) => d.severity === "error").length;
	const warnings = input.diagnostics.filter((d) => d.severity === "warning").length;
	const fixable = input.diagnostics.filter((d) => d.fixable).length;
	const hasVulnerableDeps = input.diagnostics.some(
		(d) => d.rule === "security/vulnerable-dependency",
	);

	if (input.diagnostics.length === 0 && input.score.score === 100) {
		return `${header}${renderCleanRun(
			{ score: input.score.score, label: input.score.label, elapsedMs: input.elapsedMs },
			deps,
		)}`;
	}

	const diagBlock =
		input.diagnostics.length === 0 ? "" : renderDiagnostics(input.diagnostics, input.verbose);

	const nextSteps: NextStep[] = [];
	if (fixable > 0) {
		nextSteps.push({
			emphasis: "primary",
			text: `Run ${invocation} fix to auto-fix ${fixable} issue${fixable === 1 ? "" : "s"}`,
		});
	}
	if (hasVulnerableDeps) {
		nextSteps.push({
			emphasis: "primary",
			text: `Run ${invocation} fix -f (or --force) to apply aggressive fixes (dependency audit, unused files, framework alignment)`,
		});
	}
	if (errors + warnings > 0) {
		nextSteps.push({
			emphasis: "primary",
			text: `Run ${invocation} fix --claude (or --codex, --cursor, --gemini, etc.) to hand off to agent`,
		});
	}

	const summary = renderSummary(
		{
			score: input.score.score,
			label: input.score.label,
			errors,
			warnings,
			fixable,
			files: input.fileCount,
			engines: input.results.length,
			elapsedMs: input.elapsedMs,
			nextSteps,
			thresholds: input.thresholds,
		},
		deps,
	);

	return `${header}${diagBlock}${summary}`;
};

export const scanCommand = async (
	directory: string,
	config: AislopConfig,
	options: ScanOptions,
): Promise<{ exitCode: number }> => {
	const startTime = performance.now();
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

	const showHeader = options.showHeader !== false;
	const useLiveProgress = !options.json && shouldUseSpinner();

	const projectInfo = await discoverProject(resolvedDir);

	let files: string[] | undefined;
	if (options.staged) {
		files = filterProjectFiles(resolvedDir, getStagedFiles(resolvedDir));
		if (!options.json) {
			log.muted(`Scope: ${files.length} staged file(s)`);
		}
	} else if (options.changes) {
		files = filterProjectFiles(resolvedDir, getChangedFiles(resolvedDir));
		if (!options.json) {
			log.muted(`Scope: ${files.length} changed file(s)`);
		}
	}

	const configDir = findConfigDir(resolvedDir);
	const rulesPath = configDir ? path.join(configDir, RULES_FILE) : undefined;

	const engineConfig: EngineConfig = {
		quality: config.quality,
		security: config.security,
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
		config.scoring.smoothing,
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
		const jsonOut = buildJsonOutput(results, scoreResult, projectInfo.sourceFileCount, elapsedMs);
		console.log(JSON.stringify(jsonOut, null, 2));
		return { exitCode };
	}

	const projectName = projectInfo.projectName ?? "project";
	const language = projectInfo.languages[0] ?? "unknown";
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
			includeHeader: showHeader,
			printBrand: options.printBrand,
		}),
	);

	return { exitCode };
};
