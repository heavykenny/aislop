import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { AislopConfig } from "../config/index.js";
import { findConfigDir, RULES_FILE } from "../config/index.js";
import { runEngines } from "../engines/orchestrator.js";
import type { Diagnostic, EngineConfig, EngineContext } from "../engines/types.js";
import { calculateScore } from "../scoring/index.js";
import { style, theme as defaultTheme } from "../ui/theme.js";
import { renderHeader } from "../ui/header.js";
import { LiveRail } from "../ui/live-rail.js";
import { log } from "../ui/logger.js";
import { discoverProject } from "../utils/discover.js";
import { isTelemetryDisabled, trackEvent } from "../utils/telemetry.js";
import { APP_VERSION } from "../version.js";
import { buildScanRender } from "./scan.js";
import { launchAgent, printPrompt } from "./fix-code.js";
import {
	type PipelineDeps,
	type ProjectInfo,
	runAiSlopSteps,
	runDeclarationStep,
	runDependencyStep,
	runForceSteps,
	runFormattingStep,
	runLintSteps,
} from "./fix-pipeline.js";
import { describeStep, type FixStepResult, runOneFixStep, statusFor } from "./fix-steps.js";

export { buildFixRender } from "./fix-render.js";

interface FixOptions {
	verbose: boolean;
	force?: boolean;
	/** Agent CLI to launch with remaining issues (e.g. "claude", "codex") */
	agent?: string;
	/** Print the prompt to stdout instead of launching an agent */
	prompt?: boolean;
	showHeader?: boolean;
	printBrand?: boolean;
}

const createEngineContext = (
	rootDirectory: string,
	projectInfo: ProjectInfo,
	config: AislopConfig,
): EngineContext => ({
	rootDirectory,
	languages: projectInfo.languages,
	frameworks: projectInfo.frameworks,
	installedTools: projectInfo.installedTools,
	config: { quality: config.quality, security: config.security },
});

export const fixCommand = async (
	directory: string,
	config: AislopConfig,
	options: FixOptions = { verbose: false, showHeader: true },
): Promise<void> => {
	const startTime = performance.now();
	const resolvedDir = path.resolve(directory);

	if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
		const msg = !fs.existsSync(resolvedDir)
			? `Path does not exist: ${resolvedDir}`
			: `Not a directory: ${resolvedDir}`;
		log.error(msg);
		return;
	}

	const showHeader = options.showHeader !== false;

	const projectInfo = await discoverProject(resolvedDir);
	const projectName = projectInfo.projectName ?? "project";

	if (showHeader) {
		process.stdout.write(
			renderHeader({
				version: APP_VERSION,
				command: "fix",
				context: [projectName],
				brand: options.printBrand !== false,
			}),
		);
	}

	const context = createEngineContext(resolvedDir, projectInfo, config);
	const steps: FixStepResult[] = [];
	const rail = new LiveRail();

	const runStep = async (
		name: string,
		detect: () => Promise<Diagnostic[]>,
		applyFix: () => Promise<void>,
	) => {
		rail.start(name);
		const result = await runOneFixStep(name, detect, applyFix);
		steps.push(result);
		rail.complete({ status: statusFor(result), label: describeStep(result) });
		return result;
	};

	const pipelineDeps: PipelineDeps = {
		rail,
		context,
		config,
		resolvedDir,
		projectInfo,
		force: Boolean(options.force),
		runStep,
	};

	await runAiSlopSteps(pipelineDeps);
	await runDeclarationStep(pipelineDeps);
	await runLintSteps(pipelineDeps);
	await runDependencyStep(pipelineDeps);

	await runFormattingStep(pipelineDeps);

	await runForceSteps(pipelineDeps);

	const totalResolved = steps.reduce((sum, s) => sum + s.resolvedIssues, 0);

	// Fire-and-forget anonymous telemetry
	if (!isTelemetryDisabled(config.telemetry?.enabled)) {
		trackEvent({
			command: "fix",
			languages: projectInfo.languages,
			fixSteps: steps.length,
			fixResolved: totalResolved,
		});
	}

	const configDir = findConfigDir(resolvedDir);
	const rulesPath = configDir ? path.join(configDir, RULES_FILE) : undefined;
	const engineConfig: EngineConfig = {
		quality: config.quality,
		security: config.security,
		architectureRulesPath: config.engines.architecture ? rulesPath : undefined,
	};

	rail.start("Verifying results");
	const scanResults = await runEngines(
		{
			rootDirectory: resolvedDir,
			languages: projectInfo.languages,
			frameworks: projectInfo.frameworks,
			installedTools: projectInfo.installedTools,
			config: engineConfig,
		},
		config.engines,
		() => {},
		() => {},
	);
	rail.complete({ status: "done", label: "Verification complete" });

	const allDiagnostics = scanResults.flatMap((r) => r.diagnostics);
	const scoreResult = calculateScore(
		allDiagnostics,
		config.scoring.weights,
		config.scoring.thresholds,
		projectInfo.sourceFileCount,
		config.scoring.smoothing,
	);

	const errors = allDiagnostics.filter((d) => d.severity === "error").length;
	const warnings = allDiagnostics.filter((d) => d.severity === "warning").length;
	const remaining = errors + warnings;

	// If no fix steps ran at all, emit a single "skipped" rail line so the
	// footer has context. Otherwise the step lines were already emitted live.
	if (steps.length === 0) {
		rail.complete({ status: "skipped", label: "No applicable auto-fixers found" });
	}

	rail.finish({ footer: `Done · ${totalResolved} fixed · ${remaining} remain` });

	if (!options.agent && !options.prompt) {
		if (totalResolved > 0) {
			const t = defaultTheme;
			const arrow = style(t, "muted", "→");
			process.stdout.write(
				`\n ${style(t, "success", `Resolved ${totalResolved} issue${totalResolved === 1 ? "" : "s"}`)} ${arrow} ${style(t, "success", `${scoreResult.score} / 100 ${scoreResult.label}`)}\n`,
			);
		}
		const language = projectInfo.languages[0] ?? "unknown";
		process.stdout.write(
			buildScanRender({
				projectName,
				language,
				fileCount: projectInfo.sourceFileCount,
				results: scanResults,
				diagnostics: allDiagnostics,
				score: scoreResult,
				elapsedMs: performance.now() - startTime,
				thresholds: config.scoring.thresholds,
				verbose: options.verbose,
				includeHeader: false,
				printBrand: false,
			}),
		);
	}

	if (options.agent) {
		launchAgent(options.agent, resolvedDir, allDiagnostics, scoreResult.score);
		return;
	}
	if (options.prompt) {
		printPrompt(resolvedDir, allDiagnostics, scoreResult.score);
		return;
	}
};
