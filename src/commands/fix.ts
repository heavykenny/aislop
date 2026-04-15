import fs from "node:fs";
import path from "node:path";
import type { AislopConfig } from "../config/index.js";
import { findConfigDir, RULES_FILE } from "../config/index.js";
import { detectTrivialComments } from "../engines/ai-slop/comments.js";
import { detectDeadPatterns } from "../engines/ai-slop/dead-patterns.js";
import { fixDeadPatterns } from "../engines/ai-slop/dead-patterns-fix.js";
import { detectUnusedImports } from "../engines/ai-slop/unused-imports.js";
import { fixUnusedImports } from "../engines/ai-slop/unused-imports-fix.js";
import {
	fixUnusedDependencies,
	fixUnusedFiles,
	runKnipDependencyCheck,
	runKnipUnusedFiles,
} from "../engines/code-quality/knip.js";
import { fixBiomeFormat, runBiomeFormat } from "../engines/format/biome.js";
import { fixGofmt, runGofmt } from "../engines/format/gofmt.js";
import { fixRuffFormat, runRuffFormat } from "../engines/format/ruff-format.js";
import { runExpoDoctor } from "../engines/lint/expo-doctor.js";
import { fixOxlint, fixOxlintForce, runOxlint } from "../engines/lint/oxlint.js";
import { fixRuffLint, fixRuffLintForce, runRuffLint } from "../engines/lint/ruff.js";
import { runEngines } from "../engines/orchestrator.js";
import { runDependencyAudit } from "../engines/security/audit.js";
import type { EngineConfig, EngineContext } from "../engines/types.js";
import { FixProgressRenderer, type FixStepResult } from "../output/fix-progress.js";
import {
	formatProjectSummary,
	printCommandHeader,
	printProjectMetadata,
} from "../output/layout.js";
import { calculateScore } from "../scoring/index.js";
import { discoverProject } from "../utils/discover.js";
import { highlighter } from "../utils/highlighter.js";
import { logger } from "../utils/logger.js";
import { spinner } from "../utils/spinner.js";
import { isTelemetryDisabled, trackEvent } from "../utils/telemetry.js";
import { launchAgent, printPrompt } from "./fix-code.js";
import { fixDependencyAudit, fixExpoDependencies } from "./fix-force.js";
import { buildFixStepNames } from "./fix-plan.js";
import { runFixStep, summarizeFixRun } from "./fix-step.js";

interface FixOptions {
	verbose: boolean;
	force?: boolean;
	/** Agent CLI to launch with remaining issues (e.g. "claude", "codex") */
	agent?: string;
	/** Print the prompt to stdout instead of launching an agent */
	prompt?: boolean;
	showHeader?: boolean;
}

const createEngineContext = (
	rootDirectory: string,
	projectInfo: Awaited<ReturnType<typeof discoverProject>>,
	config: AislopConfig,
): EngineContext => ({
	rootDirectory,
	languages: projectInfo.languages,
	frameworks: projectInfo.frameworks,
	installedTools: projectInfo.installedTools,
	config: {
		quality: config.quality,
		security: config.security,
	},
});

export const fixCommand = async (
	directory: string,
	config: AislopConfig,
	options: FixOptions = { verbose: false, showHeader: true },
): Promise<void> => {
	const resolvedDir = path.resolve(directory);

	if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
		const msg = !fs.existsSync(resolvedDir)
			? `Path does not exist: ${resolvedDir}`
			: `Not a directory: ${resolvedDir}`;
		logger.error(`  ${msg}`);
		return;
	}

	if (options.showHeader !== false) {
		printCommandHeader("Fix");
	}

	const projectInfo = await discoverProject(resolvedDir);
	logger.success(`  ✓ ${formatProjectSummary(projectInfo)}`);
	printProjectMetadata(projectInfo);
	const context = createEngineContext(resolvedDir, projectInfo, config);
	const steps: FixStepResult[] = [];
	const stepNames = buildFixStepNames(projectInfo, config, options);

	const progress = new FixProgressRenderer(stepNames);
	progress.start();

	// Phase 1: Code changes (imports, lint, dependencies)
	if (config.engines["ai-slop"]) {
		steps.push(
			await runFixStep(
				"Unused imports",
				() => detectUnusedImports(context),
				() => fixUnusedImports(context),
				options,
				progress,
			),
		);

		const detectFixableSlop = async () => {
			const [comments, dead] = await Promise.all([
				detectTrivialComments(context),
				detectDeadPatterns(context),
			]);
			return [...comments, ...dead].filter((d) => d.fixable);
		};

		steps.push(
			await runFixStep(
				"Dead code & comments",
				detectFixableSlop,
				() => fixDeadPatterns(context),
				options,
				progress,
			),
		);
	}

	if (config.engines.lint) {
		if (
			projectInfo.languages.includes("typescript") ||
			projectInfo.languages.includes("javascript")
		) {
			steps.push(
				await runFixStep(
					"JS/TS lint fixes",
					() => runOxlint(context),
					() => (options.force ? fixOxlintForce(context) : fixOxlint(context)),
					options,
					progress,
				),
			);
		}

		if (projectInfo.languages.includes("python") && projectInfo.installedTools.ruff) {
			steps.push(
				await runFixStep(
					"Python lint fixes",
					() => runRuffLint(context),
					() => (options.force ? fixRuffLintForce(resolvedDir) : fixRuffLint(resolvedDir)),
					options,
					progress,
				),
			);
		} else if (projectInfo.languages.includes("python")) {
			logger.warn("  Python detected but ruff is not installed; skipping Python lint fixes.");
		}
	}

	if (config.engines["code-quality"]) {
		if (
			projectInfo.languages.includes("typescript") ||
			projectInfo.languages.includes("javascript")
		) {
			steps.push(
				await runFixStep(
					"Unused dependencies",
					() => runKnipDependencyCheck(resolvedDir),
					() => fixUnusedDependencies(resolvedDir),
					options,
					progress,
				),
			);
		}
	}

	// Phase 2: Formatting (runs last to clean up after all code changes)
	if (config.engines.format) {
		if (
			projectInfo.languages.includes("typescript") ||
			projectInfo.languages.includes("javascript")
		) {
			steps.push(
				await runFixStep(
					"JS/TS formatting",
					() => runBiomeFormat(context),
					() => fixBiomeFormat(context),
					options,
					progress,
				),
			);
		}

		if (projectInfo.languages.includes("python") && projectInfo.installedTools.ruff) {
			steps.push(
				await runFixStep(
					"Python formatting",
					() => runRuffFormat(context),
					() => fixRuffFormat(resolvedDir),
					options,
					progress,
				),
			);
		} else if (projectInfo.languages.includes("python")) {
			logger.warn("  Python detected but ruff is not installed; skipping Python formatting fixes.");
		}

		if (projectInfo.languages.includes("go") && projectInfo.installedTools.gofmt) {
			steps.push(
				await runFixStep(
					"Go formatting",
					() => runGofmt(context),
					() => fixGofmt(resolvedDir),
					options,
					progress,
				),
			);
		} else if (projectInfo.languages.includes("go")) {
			logger.warn("  Go detected but gofmt is not installed; skipping Go formatting fixes.");
		}
	}

	if (options.force) {
		if (
			config.engines["code-quality"] &&
			(projectInfo.languages.includes("typescript") || projectInfo.languages.includes("javascript"))
		) {
			steps.push(
				await runFixStep(
					"Remove unused files",
					() => runKnipUnusedFiles(resolvedDir),
					() => fixUnusedFiles(resolvedDir),
					options,
					progress,
				),
			);
		}

		if (config.engines.security) {
			steps.push(
				await runFixStep(
					"Dependency audit fixes",
					() => runDependencyAudit(context),
					() => fixDependencyAudit(context),
					options,
					progress,
				),
			);
		}

		if (projectInfo.frameworks.includes("expo")) {
			steps.push(
				await runFixStep(
					"Expo dependency alignment",
					() => runExpoDoctor(context),
					() => fixExpoDependencies(context),
					options,
					progress,
				),
			);
		}
	}

	progress.stop();

	const totalResolved = steps.reduce((sum, s) => sum + s.resolvedIssues, 0);

	if (steps.length === 0) {
		logger.dim("  No applicable auto-fixers found for this project.");
	} else {
		logger.break();
		summarizeFixRun(steps);
	}

	// Fire-and-forget anonymous telemetry
	if (!isTelemetryDisabled(config.telemetry?.enabled)) {
		trackEvent({
			command: "fix",
			languages: projectInfo.languages,
			fixSteps: steps.length,
			fixResolved: totalResolved,
		});
	}

	logger.break();

	// Post-fix scan: re-run engines to calculate final score
	const verifySpinner = spinner("  Verifying results...").start();
	const configDir = findConfigDir(resolvedDir);
	const rulesPath = configDir ? path.join(configDir, RULES_FILE) : undefined;
	const engineConfig: EngineConfig = {
		quality: config.quality,
		security: config.security,
		architectureRulesPath: config.engines.architecture ? rulesPath : undefined,
	};

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

	verifySpinner.stop();

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
	const fixable = allDiagnostics.filter((d) => d.fixable).length;
	const manual = errors + warnings - fixable;

	const scoreColor =
		scoreResult.score >= config.scoring.thresholds.good
			? highlighter.success
			: scoreResult.score >= config.scoring.thresholds.ok
				? highlighter.warn
				: highlighter.error;

	logger.log(highlighter.dim("------------------------------------------------------------"));
	logger.log(highlighter.bold("Result"));
	logger.log(
		`  Score: ${scoreColor(`${scoreResult.score}/100`)} ${scoreColor(`(${scoreResult.label})`)}`,
	);
	logger.log(
		`  Resolved: ${highlighter.success(String(totalResolved))} issue${totalResolved === 1 ? "" : "s"}`,
	);
	logger.log(
		`  Remaining: ${errors + warnings > 0 ? highlighter.warn(String(errors + warnings)) : highlighter.success("0")} (${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"})`,
	);
	if (fixable > 0) {
		logger.log(`  Auto-fixable: ${highlighter.info(String(fixable))}`);
	}
	if (manual > 0) {
		logger.log(`  Manual effort: ${highlighter.dim(String(manual))}`);
	}
	logger.log(highlighter.dim("------------------------------------------------------------"));

	// --prompt: print the prompt, --claude/--codex: launch agent directly
	if (options.agent) {
		launchAgent(options.agent, resolvedDir, allDiagnostics, scoreResult.score);
		return;
	}
	if (options.prompt) {
		printPrompt(resolvedDir, allDiagnostics, scoreResult.score);
		return;
	}

	// Next steps guidance
	const nextSteps: string[] = [];
	if (!options.force && errors + warnings > 0) {
		nextSteps.push(
			`Run ${highlighter.info("fix -f")} to try aggressive fixes (dependency audit, unused files, unsafe lint)`,
		);
	}
	if (errors + warnings > 0 && !options.agent && !options.prompt) {
		nextSteps.push(
			`Run ${highlighter.info("fix --<agent>")} to hand off to a coding agent, or ${highlighter.info("fix --prompt")} to copy the prompt`,
		);
		nextSteps.push(
			highlighter.dim(
				"Agents: --claude, --codex, --gemini, --opencode, --cursor, --amp, --aider, --goose and more",
			),
		);
	}
	if (errors + warnings > 0) {
		nextSteps.push(`Run ${highlighter.info("scan")} to see remaining issues with full details`);
	}
	if (nextSteps.length > 0) {
		logger.break();
		logger.log(highlighter.bold("Next steps"));
		for (let i = 0; i < nextSteps.length; i++) {
			logger.log(`  ${i + 1}. ${nextSteps[i]}`);
		}
	}

	logger.break();
};
