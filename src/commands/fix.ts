import path from "node:path";
import { performance } from "node:perf_hooks";
import type { AislopConfig } from "../config/index.js";
import { fixBiomeFormat, runBiomeFormat } from "../engines/format/biome.js";
import { fixGofmt, runGofmt } from "../engines/format/gofmt.js";
import { fixRuffFormat, runRuffFormat } from "../engines/format/ruff-format.js";
import {
	fixUnusedDependencies,
	runKnipDependencyCheck,
} from "../engines/code-quality/knip.js";
import {
	detectUnusedImports,
} from "../engines/ai-slop/unused-imports.js";
import { fixUnusedImports } from "../engines/ai-slop/unused-imports-fix.js";
import { fixOxlint, runOxlint } from "../engines/lint/oxlint.js";
import { fixRuffLint, runRuffLint } from "../engines/lint/ruff.js";
import type { Diagnostic, EngineContext } from "../engines/types.js";
import {
	formatElapsed,
	formatProjectSummary,
	printCommandHeader,
	printProjectMetadata,
} from "../output/layout.js";
import { printMaybePaged } from "../output/pager.js";
import { discoverProject } from "../utils/discover.js";
import { highlighter } from "../utils/highlighter.js";
import { logger } from "../utils/logger.js";
import { isTelemetryDisabled, trackEvent } from "../utils/telemetry.js";

interface FixOptions {
	verbose: boolean;
	showHeader?: boolean;
}

interface FixStepResult {
	name: string;
	beforeIssues: number;
	afterIssues: number;
	resolvedIssues: number;
	beforeFiles: number;
	failed: boolean;
	elapsedMs: number;
}

const uniqueFiles = (diagnostics: Diagnostic[]): string[] => [
	...new Set(diagnostics.map((d) => d.filePath)),
];

const uniqueFileCount = (diagnostics: Diagnostic[]): number =>
	uniqueFiles(diagnostics).length;

const getFilePreviewLines = (
	title: string,
	files: string[],
	verbose: boolean,
): string[] => {
	if (files.length === 0) return [];

	const lines = [highlighter.dim(`    ${title}: ${files.length} file(s)`)];
	const preview = verbose ? files : files.slice(0, 5);
	for (const file of preview) {
		lines.push(highlighter.dim(`      ${file}`));
	}
	if (!verbose && files.length > preview.length) {
		lines.push(
			highlighter.dim(
				`      +${files.length - preview.length} more file(s), use -d for full list`,
			),
		);
	}

	return lines;
};

const getReasonLines = (
	reason: string,
): { firstLine: string; printable: string } => {
	const firstLine =
		reason.split("\n").find((line) => line.trim().length > 0) ?? reason;
	return { firstLine, printable: reason };
};

const getStepStatusLine = (
	result: FixStepResult,
	name: string,
	elapsedLabel: string,
): string => {
	if (result.failed) {
		return highlighter.error(
			`  ✗ ${name}: failed (${result.afterIssues} issue${result.afterIssues === 1 ? "" : "s"} remain, ${elapsedLabel})`,
		);
	}

	if (result.beforeIssues === 0) {
		return highlighter.success(`  ✓ ${name}: done (0 issues, ${elapsedLabel})`);
	}

	if (result.afterIssues === 0) {
		return highlighter.success(
			`  ✓ ${name}: done (${result.resolvedIssues} resolved across ${result.beforeFiles} file(s), ${elapsedLabel})`,
		);
	}

	if (result.resolvedIssues > 0) {
		return highlighter.warn(
			`  ! ${name}: done (${result.resolvedIssues} resolved, ${result.afterIssues} remaining, ${elapsedLabel})`,
		);
	}

	return highlighter.warn(
		`  ! ${name}: done (no auto-fix changes, ${result.afterIssues} issue${result.afterIssues === 1 ? "" : "s"}, ${elapsedLabel})`,
	);
};

const runFixStep = async (
	name: string,
	detect: () => Promise<Diagnostic[]>,
	applyFix: () => Promise<void>,
	options: FixOptions,
): Promise<FixStepResult> => {
	const stepStart = performance.now();

	const before = await detect();
	let applyError: unknown = null;

	try {
		await applyFix();
	} catch (error) {
		applyError = error;
	}

	const after = await detect();
	const elapsedMs = performance.now() - stepStart;
	const result: FixStepResult = {
		name,
		beforeIssues: before.length,
		afterIssues: after.length,
		resolvedIssues: Math.max(0, before.length - after.length),
		beforeFiles: uniqueFileCount(before),
		failed: applyError !== null && before.length === after.length,
		elapsedMs,
	};

	const elapsedLabel = formatElapsed(result.elapsedMs);
	const lines = [getStepStatusLine(result, name, elapsedLabel)];

	if (applyError) {
		const reason =
			applyError instanceof Error ? applyError.message : String(applyError);
		const reasonLines = getReasonLines(reason);
		const reasonToPrint = options.verbose
			? reasonLines.printable
			: reasonLines.firstLine;
		for (const line of reasonToPrint.split("\n")) {
			lines.push(highlighter.dim(`      ${line}`));
		}
		if (!options.verbose && reasonLines.printable !== reasonToPrint) {
			lines.push(highlighter.dim("      Re-run with -d for full tool output."));
		}
	}

	lines.push(
		...getFilePreviewLines("Affected", uniqueFiles(before), options.verbose),
	);
	if (after.length > 0) {
		lines.push(
			...getFilePreviewLines("Remaining", uniqueFiles(after), options.verbose),
		);
	}

	await printMaybePaged(`${lines.join("\n")}\n\n`);

	return result;
};

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

const summarizeFixRun = (steps: FixStepResult[]): void => {
	const totals = steps.reduce(
		(acc, step) => {
			acc.beforeIssues += step.beforeIssues;
			acc.afterIssues += step.afterIssues;
			acc.resolvedIssues += step.resolvedIssues;
			if (step.failed) acc.failedSteps += 1;
			return acc;
		},
		{ beforeIssues: 0, afterIssues: 0, resolvedIssues: 0, failedSteps: 0 },
	);

	if (totals.failedSteps > 0) {
		logger.log(
			`  Fix summary: checked ${steps.length} step(s), resolved ${totals.resolvedIssues} issue(s).`,
		);
		logger.warn(
			`  ${totals.failedSteps} step(s) reported tool errors; unresolved issue count is unknown for failed steps.`,
		);
	} else {
		logger.log(
			`  Fix summary: checked ${steps.length} step(s), resolved ${totals.resolvedIssues} issue(s), remaining ${totals.afterIssues}.`,
		);
	}

	if (
		totals.failedSteps === 0 &&
		totals.beforeIssues > 0 &&
		totals.resolvedIssues === 0
	) {
		logger.dim(
			"  No auto-fixable changes were applied. Current findings are likely manual-fix categories.",
		);
	}
};

export const fixCommand = async (
	directory: string,
	config: AislopConfig,
	options: FixOptions = { verbose: false, showHeader: true },
): Promise<void> => {
	const resolvedDir = path.resolve(directory);

	if (options.showHeader !== false) {
		printCommandHeader("Fix");
	}

	const projectInfo = await discoverProject(resolvedDir);
	logger.success(`  ✓ ${formatProjectSummary(projectInfo)}`);
	printProjectMetadata(projectInfo);
	const context = createEngineContext(resolvedDir, projectInfo, config);
	const steps: FixStepResult[] = [];

	if (config.engines["ai-slop"]) {
		steps.push(
			await runFixStep(
				"Unused imports",
				() => detectUnusedImports(context),
				() => fixUnusedImports(context),
				options,
			),
		);
	}

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
				),
			);
		}

		if (
			projectInfo.languages.includes("python") &&
			projectInfo.installedTools.ruff
		) {
			steps.push(
				await runFixStep(
					"Python formatting",
					() => runRuffFormat(context),
					() => fixRuffFormat(resolvedDir),
					options,
				),
			);
		} else if (projectInfo.languages.includes("python")) {
			logger.warn(
				"  Python detected but ruff is not installed; skipping Python formatting fixes.",
			);
		}

		if (
			projectInfo.languages.includes("go") &&
			projectInfo.installedTools.gofmt
		) {
			steps.push(
				await runFixStep(
					"Go formatting",
					() => runGofmt(context),
					() => fixGofmt(resolvedDir),
					options,
				),
			);
		} else if (projectInfo.languages.includes("go")) {
			logger.warn(
				"  Go detected but gofmt is not installed; skipping Go formatting fixes.",
			);
		}
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
					() => fixOxlint(context),
					options,
				),
			);
		}

		if (
			projectInfo.languages.includes("python") &&
			projectInfo.installedTools.ruff
		) {
			steps.push(
				await runFixStep(
					"Python lint fixes",
					() => runRuffLint(context),
					() => fixRuffLint(resolvedDir),
					options,
				),
			);
		} else if (projectInfo.languages.includes("python")) {
			logger.warn(
				"  Python detected but ruff is not installed; skipping Python lint fixes.",
			);
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
				),
			);
		}
	}

	if (steps.length === 0) {
		logger.dim("  No applicable auto-fixers found for this project.");
	} else {
		logger.break();
		summarizeFixRun(steps);
	}

	// Fire-and-forget anonymous telemetry
	if (!isTelemetryDisabled(config.telemetry?.enabled)) {
		const totalResolved = steps.reduce((sum, s) => sum + s.resolvedIssues, 0);
		trackEvent({
			command: "fix",
			languages: projectInfo.languages,
			fixSteps: steps.length,
			fixResolved: totalResolved,
		});
	}

	logger.break();
	logger.success("  ✓ Done. Run `aislop scan` to verify.");
	logger.break();
};
