import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { type AislopConfig, findConfigDir, RULES_FILE } from "../config/index.js";
import { runEngines } from "../engines/orchestrator.js";
import type { Diagnostic, EngineConfig, EngineResult } from "../engines/types.js";
import { calculateScore } from "../scoring/index.js";
import { withCommandLifecycle } from "../telemetry/index.js";
import { renderHeader } from "../ui/header.js";
import { LiveRail } from "../ui/live-rail.js";
import { log, renderHintLine } from "../ui/logger.js";
import { theme as defaultTheme, style } from "../ui/theme.js";
import { discoverProject } from "../utils/discover.js";
import { APP_VERSION } from "../version.js";
import { launchAgent, printPrompt } from "./fix-code.js";
import { createEngineContext } from "./fix-context.js";
import {
	type PipelineDeps,
	runAiSlopSteps,
	runDeclarationStep,
	runDependencyStep,
	runForceSteps,
	runFormattingStep,
	runLintSteps,
} from "./fix-pipeline.js";
import { buildFixPlan, skippedFixSteps } from "./fix-plan.js";
import { NO_CHANGES_APPLIED } from "./fix-render.js";
import {
	describePreviewStep,
	describeSkippedStep,
	describeStep,
	type FixStepResult,
	runOneFixStep,
	statusFor,
} from "./fix-steps.js";
import { buildScanRender } from "./scan.js";

export { buildFixRender } from "./fix-render.js";

interface FixOptions {
	verbose: boolean;
	force?: boolean;
	/** Restrict to reversible fixes only (imports, comment removal, safe formatter runs) */
	safe?: boolean;
	/** Detect and print the plan without invoking mutating fixers */
	dryRun?: boolean;
	/** Agent CLI to launch with remaining issues (e.g. "claude", "codex") */
	agent?: string;
	/** Print the prompt to stdout instead of launching an agent */
	prompt?: boolean;
	showHeader?: boolean;
	printBrand?: boolean;
}

export const buildPostFixVerificationEngines = (
	engines: AislopConfig["engines"],
): AislopConfig["engines"] => ({
	...engines,
	// `fix` should not silently run project-evaluating linters after applying
	// fixes. The lint engine can invoke tools such as cargo clippy, RuboCop,
	// and expo-doctor, which may execute repository-controlled code/config.
	lint: false,
});

const collectPostFixLintDiagnostics = (steps: FixStepResult[]): Diagnostic[] =>
	steps
		.filter((step) => step.name.startsWith("Lint fixes"))
		.flatMap((step) => step.afterDiagnostics ?? []);

const appendPostFixLintResult = (
	results: EngineResult[],
	lintDiagnostics: Diagnostic[],
): EngineResult[] => {
	if (lintDiagnostics.length === 0) return results;
	return [
		...results,
		{
			engine: "lint",
			diagnostics: lintDiagnostics,
			elapsed: 0,
			skipped: false,
		},
	];
};

export const fixCommand = async (
	directory: string,
	config: AislopConfig,
	options: FixOptions = { verbose: false, showHeader: true },
): Promise<{ exitCode: number }> => {
	const resolvedDir = path.resolve(directory);
	const pathExists = fs.existsSync(resolvedDir);

	if (!pathExists || !fs.statSync(resolvedDir).isDirectory()) {
		const msg = !pathExists
			? `Path does not exist: ${resolvedDir}`
			: `Not a directory: ${resolvedDir}`;
		return withCommandLifecycle({ command: "fix", config: config.telemetry }, async () => {
			log.error(msg);
			return { exitCode: 1 };
		});
	}

	const projectInfo = await discoverProject(resolvedDir);

	return withCommandLifecycle(
		{
			command: "fix",
			config: config.telemetry,
			languages: projectInfo.languages,
			fileCount: projectInfo.sourceFileCount,
			properties: options.dryRun ? { dry_run: true } : undefined,
		},
		() => runFixBody(resolvedDir, config, options, projectInfo),
	);
};

const runFixPipeline = async (deps: PipelineDeps, safe: boolean): Promise<void> => {
	await runAiSlopSteps(deps);
	if (!safe) {
		await runDeclarationStep(deps);
		await runLintSteps(deps);
		await runDependencyStep(deps);
	}
	await runFormattingStep(deps);
	await runForceSteps(deps);
};

const finishDryRun = (input: {
	rail: LiveRail;
	steps: FixStepResult[];
	projectInfo: Awaited<ReturnType<typeof discoverProject>>;
	config: AislopConfig;
	options: FixOptions;
}): { exitCode: number; fixSteps: number; fixResolved: number } => {
	const plan = buildFixPlan(input.projectInfo, input.config, {
		force: Boolean(input.options.force),
		safe: Boolean(input.options.safe),
	});
	const ran = new Set(input.steps.map((step) => step.name));
	for (const step of skippedFixSteps(plan)) {
		if (ran.has(step.name)) continue;
		input.rail.complete({
			status: "skipped",
			label: describeSkippedStep(step.name, step.reason ?? "skipped"),
		});
	}
	if (input.steps.length === 0 && skippedFixSteps(plan).length === 0) {
		input.rail.complete({ status: "skipped", label: "No applicable auto-fixers found" });
	}
	input.rail.finish({ footer: "Preview · no changes applied" });
	process.stdout.write(`\n${renderHintLine(NO_CHANGES_APPLIED)}`);
	return {
		exitCode: 0,
		fixSteps: input.steps.length,
		fixResolved: 0,
	};
};

const runFixBody = async (
	resolvedDir: string,
	config: AislopConfig,
	options: FixOptions,
	projectInfo: Awaited<ReturnType<typeof discoverProject>>,
) => {
	const startTime = performance.now();
	const showHeader = options.showHeader !== false;
	const projectName = projectInfo.projectName ?? "project";

	const dryRun = Boolean(options.dryRun);
	if (showHeader) {
		process.stdout.write(
			renderHeader({
				version: APP_VERSION,
				command: dryRun ? "Fix plan" : "Fix run",
				context: [projectName],
				brand: options.printBrand !== false,
			}),
		);
	}

	const safe = Boolean(options.safe);
	const context = createEngineContext(resolvedDir, projectInfo, config, { safe });
	const steps: FixStepResult[] = [];
	const rail = new LiveRail(process.env.CI === "1" ? { tty: false } : {});

	const runStep = async (
		name: string,
		detect: () => Promise<Diagnostic[]>,
		applyFix: () => Promise<void>,
	) => {
		rail.start(name);
		const result = await runOneFixStep(name, detect, applyFix, { dryRun });
		steps.push(result);
		rail.complete({
			status: dryRun ? "done" : statusFor(result),
			label: dryRun ? describePreviewStep(result) : describeStep(result),
		});
		return result;
	};

	const pipelineDeps: PipelineDeps = {
		rail,
		context,
		config,
		resolvedDir,
		projectInfo,
		force: safe ? false : Boolean(options.force),
		safe,
		runStep,
	};

	await runFixPipeline(pipelineDeps, safe);

	if (dryRun) {
		return finishDryRun({
			rail,
			steps,
			projectInfo,
			config,
			options,
		});
	}

	const totalResolved = steps.reduce((sum, s) => sum + s.resolvedIssues, 0);

	const configDir = findConfigDir(resolvedDir);
	const rulesPath = configDir ? path.join(configDir, RULES_FILE) : undefined;
	const engineConfig: EngineConfig = {
		quality: config.quality,
		security: config.security,
		lint: config.lint,
		architectureRulesPath: config.engines.architecture ? rulesPath : undefined,
	};

	rail.start("Verifying results");
	const verificationResults = await runEngines(
		{
			rootDirectory: resolvedDir,
			languages: projectInfo.languages,
			frameworks: projectInfo.frameworks,
			excludePatterns: context.excludePatterns,
			installedTools: context.installedTools,
			config: engineConfig,
		},
		buildPostFixVerificationEngines(config.engines),
		() => {},
		() => {},
	);
	rail.complete({ status: "done", label: "Verification complete" });
	const scanResults = appendPostFixLintResult(
		verificationResults,
		collectPostFixLintDiagnostics(steps),
	);

	const allDiagnostics = scanResults.flatMap((r) => r.diagnostics);
	const scoreResult = calculateScore(
		allDiagnostics,
		config.scoring.weights,
		config.scoring.thresholds,
		projectInfo.sourceFileCount,
		config.scoring.smoothing,
		config.scoring.maxPerRule,
	);

	const errors = allDiagnostics.filter((d) => d.severity === "error").length;
	const warnings = allDiagnostics.filter((d) => d.severity === "warning").length;
	const remaining = errors + warnings;
	const actionableDiagnostics = allDiagnostics.filter((d) => d.severity !== "info");

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
				diagnostics: actionableDiagnostics,
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
		launchAgent(options.agent, resolvedDir, actionableDiagnostics, scoreResult.score);
		return {
			exitCode: 0,
			score: scoreResult.score,
			fixSteps: steps.length,
			fixResolved: totalResolved,
		};
	}
	if (options.prompt) {
		printPrompt(resolvedDir, actionableDiagnostics, scoreResult.score);
		return {
			exitCode: 0,
			score: scoreResult.score,
			fixSteps: steps.length,
			fixResolved: totalResolved,
		};
	}

	return {
		exitCode: 0,
		score: scoreResult.score,
		findingCount: allDiagnostics.length,
		errorCount: errors,
		warningCount: warnings,
		fixSteps: steps.length,
		fixResolved: totalResolved,
	};
};
