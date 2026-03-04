import type { Diagnostic } from "../engines/types.js";

export interface ScoreResult {
	score: number;
	label: string;
}

const PERFECT_SCORE = 100;

export const calculateScore = (
	diagnostics: Diagnostic[],
	weights: Record<string, number>,
	thresholds: { good: number; ok: number },
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
