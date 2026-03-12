import type { Diagnostic } from "../engines/types.js";

export interface ScoreResult {
	score: number;
	label: string;
}

const PERFECT_SCORE = 100;

/**
 * Smoothing constant for issue-density calculation.
 *
 * Prevents extreme scores when sourceFileCount is very small (e.g. 1-2 files).
 * With SMOOTHING=10, a single issue in a 2-file project has density
 * 1/(2+10)=0.083 rather than 1/2=0.5, keeping the penalty reasonable.
 * The value 10 was chosen empirically: it keeps single-issue scores in the
 * 75-90 range for small projects and 90-98 for large ones.
 */
const ISSUE_DENSITY_SMOOTHING = 10;

/**
 * Calculate a project health score from diagnostics.
 *
 * When `sourceFileCount` is provided, deductions are scaled by issue density
 * so that sparse issues in large codebases are penalised less than the same
 * issues concentrated in a small project. This fixes the problem where a
 * single innerHTML in a 200-file project would tank the score just as much
 * as in a 2-file project (see issue #9).
 *
 * When `sourceFileCount` is omitted (e.g. direct library callers), the
 * function falls back to the original behavior with no density scaling.
 */
export const calculateScore = (
	diagnostics: Diagnostic[],
	weights: Record<string, number>,
	thresholds: { good: number; ok: number },
	sourceFileCount?: number,
): ScoreResult => {
	if (diagnostics.length === 0) {
		return { score: PERFECT_SCORE, label: "Healthy" };
	}

	let deductions = 0;

	for (const d of diagnostics) {
		const engineWeight = weights[d.engine] ?? 1.0;
		const severityPenalty =
			d.severity === "error" ? 3 : d.severity === "warning" ? 1 : 0.25;
		deductions += severityPenalty * engineWeight;
	}

	// Scale deductions by issue density when file count is known.
	// density = issues / (files + smoothing), capped at 1.0 so heavily
	// polluted codebases behave like the old algorithm.
	// sqrt dampens the scaling so issues always matter — just less in big projects.
	if (sourceFileCount != null && sourceFileCount > 0) {
		const density = Math.min(
			1,
			diagnostics.length / (sourceFileCount + ISSUE_DENSITY_SMOOTHING),
		);
		deductions *= Math.sqrt(density);
	}

	// Logarithmic scaling: first issues matter most, score can't go below 0
	const score = Math.max(
		0,
		Math.round(
			PERFECT_SCORE -
				(PERFECT_SCORE * Math.log1p(deductions)) /
					Math.log1p(PERFECT_SCORE + deductions),
		),
	);

	const label =
		score >= thresholds.good
			? "Healthy"
			: score >= thresholds.ok
				? "Needs Work"
				: "Critical";

	return { score, label };
};

export const getScoreColor = (
	score: number,
	thresholds: { good: number; ok: number },
): "success" | "warn" | "error" => {
	if (score >= thresholds.good) return "success";
	if (score >= thresholds.ok) return "warn";
	return "error";
};
