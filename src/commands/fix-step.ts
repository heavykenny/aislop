import { performance } from "node:perf_hooks";
import type { Diagnostic } from "../engines/types.js";
import type { FixProgressRenderer, FixStepResult } from "../output/fix-progress.js";
import { formatElapsed } from "../output/layout.js";
import { highlighter } from "../utils/highlighter.js";
import { logger } from "../utils/logger.js";

interface FixOptions {
	verbose: boolean;
	force?: boolean;
	showHeader?: boolean;
}

const uniqueFiles = (diagnostics: Diagnostic[]): string[] => [
	...new Set(diagnostics.map((d) => d.filePath)),
];

const uniqueFileCount = (diagnostics: Diagnostic[]): number => uniqueFiles(diagnostics).length;

const getFilePreviewLines = (title: string, files: string[], verbose: boolean): string[] => {
	if (files.length === 0) return [];

	const lines = [highlighter.dim(`    ${title}: ${files.length} file(s)`)];
	const preview = verbose ? files : files.slice(0, 5);
	for (const file of preview) {
		lines.push(highlighter.dim(`      ${file}`));
	}
	if (!verbose && files.length > preview.length) {
		lines.push(
			highlighter.dim(`      +${files.length - preview.length} more file(s), use -d for full list`),
		);
	}

	return lines;
};

const getReasonLines = (reason: string): { firstLine: string; printable: string } => {
	const firstLine = reason.split("\n").find((line) => line.trim().length > 0) ?? reason;
	return { firstLine, printable: reason };
};

const getStepStatusLine = (result: FixStepResult, name: string, elapsedLabel: string): string => {
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

export const runFixStep = async (
	name: string,
	detect: () => Promise<Diagnostic[]>,
	applyFix: () => Promise<void>,
	options: FixOptions,
	progress: FixProgressRenderer,
): Promise<FixStepResult> => {
	progress.markStarted(name);

	const stepStart = performance.now();

	const before = await detect();
	let applyError: unknown = null;

	// Only run the fix if there are issues to fix
	if (before.length > 0) {
		try {
			await applyFix();
		} catch (error) {
			applyError = error;
		}
	}

	const after = before.length > 0 ? await detect() : before;
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

	progress.markComplete(name, result);

	// When not in a live TTY, print step-by-step fallback output
	if (!progress.isLive()) {
		const elapsedLabel = formatElapsed(result.elapsedMs);
		const lines = [getStepStatusLine(result, name, elapsedLabel)];

		if (applyError) {
			const reason = applyError instanceof Error ? applyError.message : String(applyError);
			const reasonLines = getReasonLines(reason);
			const reasonToPrint = options.verbose ? reasonLines.printable : reasonLines.firstLine;
			for (const line of reasonToPrint.split("\n")) {
				lines.push(highlighter.dim(`      ${line}`));
			}
			if (!options.verbose && reasonLines.printable !== reasonToPrint) {
				lines.push(highlighter.dim("      Re-run with -d for full tool output."));
			}
		}

		lines.push(...getFilePreviewLines("Affected", uniqueFiles(before), options.verbose));
		if (after.length > 0) {
			lines.push(...getFilePreviewLines("Remaining", uniqueFiles(after), options.verbose));
		}

		process.stdout.write(`${lines.join("\n")}\n\n`);
	}

	return result;
};

export const summarizeFixRun = (steps: FixStepResult[]): void => {
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

	if (totals.failedSteps === 0 && totals.beforeIssues > 0 && totals.resolvedIssues === 0) {
		logger.dim(
			"  Remaining issues require manual fixes or agent assistance. Run `scan` for details.",
		);
	}
};
