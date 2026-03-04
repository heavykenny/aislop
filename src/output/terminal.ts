import type { Diagnostic, EngineResult } from "../engines/types.js";
import type { ScoreResult } from "../scoring/index.js";
import { getScoreColor } from "../scoring/index.js";
import { highlighter } from "../utils/highlighter.js";
import { logger } from "../utils/logger.js";

const PERFECT_SCORE = 100;

const groupBy = <T>(items: T[], key: (item: T) => string): Map<string, T[]> => {
	const map = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const group = map.get(k) ?? [];
		group.push(item);
		map.set(k, group);
	}
	return map;
};

const colorBySeverity = (text: string, severity: string): string =>
	severity === "error" ? highlighter.error(text) : highlighter.warn(text);

const colorByScore = (
	text: string,
	score: number,
	thresholds: { good: number; ok: number },
): string => {
	const color = getScoreColor(score, thresholds);
	return highlighter[color](text);
};

const toElapsedLabel = (elapsedMs: number): string =>
	elapsedMs < 1000
		? `${Math.round(elapsedMs)}ms`
		: `${(elapsedMs / 1000).toFixed(1)}s`;

const toSeverityLabel = (severity: Diagnostic["severity"]): string => {
	if (severity === "error") return "ERROR";
	if (severity === "warning") return "WARN";
	return "INFO";
};

export const printDiagnostics = (
	diagnostics: Diagnostic[],
	verbose: boolean,
): void => {
	const byEngine = groupBy(diagnostics, (d) => d.engine);

	for (const [engine, engineDiags] of byEngine) {
		logger.log(`  ${highlighter.bold(engine)}`);

		const byRule = groupBy(engineDiags, (d) => `${d.rule}:${d.message}`);
		const sorted = [...byRule.entries()].sort(([, a], [, b]) => {
			const sa =
				a[0].severity === "error" ? 0 : a[0].severity === "warning" ? 1 : 2;
			const sb =
				b[0].severity === "error" ? 0 : b[0].severity === "warning" ? 1 : 2;
			return sa - sb;
		});

		for (const [, ruleDiags] of sorted) {
			const first = ruleDiags[0];
			const level = toSeverityLabel(first.severity);
			const count = ruleDiags.length > 1 ? ` (${ruleDiags.length})` : "";
			const status = colorBySeverity(level, first.severity);

			logger.log(`    [${status}] ${first.message}${count}`);
			if (first.help) {
				logger.dim(`    ${first.help}`);
			}

			if (verbose) {
				for (const d of ruleDiags) {
					const lineLabel = d.line > 0 ? `:${d.line}` : "";
					logger.dim(`      ${d.filePath}${lineLabel}`);
				}
			}

			logger.log("");
		}
	}
};

export const printSummary = (
	diagnostics: Diagnostic[],
	scoreResult: ScoreResult,
	elapsedMs: number,
	fileCount: number,
	thresholds: { good: number; ok: number },
): void => {
	const errorCount = diagnostics.filter((d) => d.severity === "error").length;
	const warningCount = diagnostics.filter(
		(d) => d.severity === "warning",
	).length;
	const elapsed = toElapsedLabel(elapsedMs);

	logger.log(highlighter.bold("Summary"));
	logger.log(
		`  Score: ${colorByScore(`${scoreResult.score}/${PERFECT_SCORE}`, scoreResult.score, thresholds)} ${colorByScore(`(${scoreResult.label})`, scoreResult.score, thresholds)}`,
	);
	logger.log(
		`  Issues: ${highlighter.error(`${errorCount} error${errorCount === 1 ? "" : "s"}`)}, ${highlighter.warn(`${warningCount} warning${warningCount === 1 ? "" : "s"}`)}`,
	);
	logger.log(`  Files: ${highlighter.info(String(fileCount))}`);
	logger.log(`  Time: ${highlighter.info(elapsed)}`);
};

export const printEngineStatus = (result: EngineResult): void => {
	const elapsed = toElapsedLabel(result.elapsed);

	if (result.skipped) {
		logger.dim(
			`  - ${result.engine}: SKIPPED${result.skipReason ? ` (${result.skipReason})` : ""}`,
		);
	} else if (result.diagnostics.length === 0) {
		logger.success(`  - ${result.engine}: PASS (${elapsed})`);
	} else {
		const errors = result.diagnostics.filter(
			(d) => d.severity === "error",
		).length;
		const warnings = result.diagnostics.filter(
			(d) => d.severity === "warning",
		).length;
		const parts: string[] = [];
		if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
		if (warnings > 0)
			parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
		const statusText = `${parts.join(", ")} (${elapsed})`;

		if (errors > 0) {
			logger.error(`  - ${result.engine}: FAIL ${statusText}`);
		} else {
			logger.warn(`  - ${result.engine}: WARN ${statusText}`);
		}
	}
};
