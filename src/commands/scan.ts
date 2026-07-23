import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { type AislopConfig, findConfigDir, RULES_FILE } from "../config/index.js";
import type { EngineConfig } from "../engines/types.js";
import { renderDiagnostics } from "../output/terminal.js";
import { calculateScore } from "../scoring/index.js";
import { applyRuleSeverities } from "../scoring/rule-severity.js";
import { isCiEnv } from "../telemetry/env.js";
import { type EngineCounts, withCommandLifecycle } from "../telemetry/index.js";
import { renderDisplayRows } from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { log } from "../ui/logger.js";
import { detectSourceLanguages, discoverProject } from "../utils/discover.js";
import { baseRefExists } from "../utils/git.js";
import { appendHistory } from "../utils/history.js";
import { readAislopIgnorePatterns } from "../utils/source-files.js";
import { applySuppressions } from "../utils/suppress.js";
import { APP_VERSION } from "../version.js";
import { renderCoverageNotice } from "./scan-coverage.js";
import { runEnginesWithProgress } from "./scan-engine-runner.js";
import { computeScanExitCode } from "./scan-exit-code.js";
import { collectScanFileScope, deriveScanCoverage, type ScanScopeMode } from "./scan-file-scope.js";
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

const renderScopeRow = (value: string): string =>
	`${renderDisplayRows([{ label: "Scope", value }], { indent: 1 }).join("\n")}\n`;

const resolveScanScopeMode = (options: ScanOptions): ScanScopeMode => {
	if (options.staged) return { kind: "staged" };
	if (options.changes) {
		return options.base ? { kind: "changes", base: options.base } : { kind: "changes" };
	}
	return { kind: "full" };
};

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
	const scanScope = collectScanFileScope({
		excludePatterns,
		includePatterns: config.include,
		mode: resolveScanScopeMode(options),
		rootDirectory: resolvedDir,
	});
	const discoveredProject = await discoverProject(resolvedDir, excludePatterns, {
		includePatterns: config.include,
	});
	const projectInfo = {
		...discoveredProject,
		languages: detectSourceLanguages([...scanScope.files, ...scanScope.testFiles]),
	};

	return withCommandLifecycle(
		{
			command: options.command ?? "scan",
			config: config.telemetry,
			languages: projectInfo.languages,
			fileCount: scanScope.scoreFileCount,
		},
		() => runScanBody(resolvedDir, config, options, projectInfo, scanScope),
	);
};

const runScanBody = async (
	resolvedDir: string,
	config: AislopConfig,
	options: ScanOptions,
	projectInfo: Awaited<ReturnType<typeof discoverProject>>,
	scanScope: ReturnType<typeof collectScanFileScope>,
) => {
	const startTime = performance.now();
	const showHeader = options.showHeader !== false;
	const machineOutput = isMachineOutput(options);
	const projectName = projectInfo.projectName ?? "project";
	const language = projectInfo.languages[0] ?? "unknown";
	const printedHumanHeader = !machineOutput && showHeader;
	const { files, projectFiles, scoreFileCount, scopeLabel, testFiles } = scanScope;
	const scanCoverage = deriveScanCoverage(projectInfo.coverage, scoreFileCount);
	const reportProjectInfo = {
		...projectInfo,
		coverage: scanCoverage,
		sourceFileCount: scoreFileCount,
	};

	if (printedHumanHeader) {
		process.stdout.write(
			renderHeader({
				version: APP_VERSION,
				command: "Scan result",
				context: [projectName, language, `${scoreFileCount} files`],
				brand: options.printBrand !== false,
			}),
		);
	}

	if (!machineOutput) {
		process.stdout.write(renderScopeRow(`${files.length + testFiles.length} ${scopeLabel}`));
	}

	const configDir = findConfigDir(resolvedDir);
	const rulesPath = configDir ? path.join(configDir, RULES_FILE) : undefined;

	const engineConfig: EngineConfig = {
		quality: config.quality,
		security: config.security,
		lint: config.lint,
		architectureRulesPath: config.engines.architecture ? rulesPath : undefined,
	};

	const rawResults = await runEnginesWithProgress(
		{
			rootDirectory: resolvedDir,
			languages: projectInfo.languages,
			frameworks: projectInfo.frameworks,
			files,
			testFiles,
			projectFiles,
			installedTools: projectInfo.installedTools,
			config: engineConfig,
		},
		config.engines,
		machineOutput,
	);

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
		scoreFileCount,
		config.scoring.smoothing,
		config.scoring.maxPerRule,
	);
	const scoreable = scanCoverage.scoreable;
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
		const jsonOut = buildJsonOutput(results, scoreResult, scoreFileCount, elapsedMs, scanCoverage);
		console.log(JSON.stringify(jsonOut, null, 2));
		return completion;
	}

	if (!scoreable) {
		if (!machineOutput) {
			process.stdout.write(
				renderCoverageNotice(reportProjectInfo, !printedHumanHeader && showHeader),
			);
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
			files: scoreFileCount,
		});
	}

	process.stdout.write(
		buildScanRender({
			projectName,
			language,
			fileCount: scoreFileCount,
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
