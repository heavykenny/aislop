import type { Diagnostic } from "../engines/types.js";

export interface ScoreResult {
	score: number;
	label: string;
}

const PERFECT_SCORE = 100;

const getEffectiveFileCount = (
	diagnostics: Diagnostic[],
	sourceFileCount?: number,
): number => {
	if (typeof sourceFileCount === "number" && sourceFileCount > 0) {
		return sourceFileCount;
	}

	// Fallback for direct API use when caller doesn't provide source file count.
	const filesWithDiagnostics = new Set(diagnostics.map((d) => d.filePath)).size;
	return Math.max(1, filesWithDiagnostics);
};

export const calculateScore = (
	diagnostics: Diagnostic[],
	weights: Record<string, number>,
	thresholds: { good: number; ok: number },
	sourceFileCount?: number,
	smoothing?: number,
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

	const effectiveFileCount = getEffectiveFileCount(
		diagnostics,
		sourceFileCount,
	);
	// Smoothing constant for issue density normalization is now configurable via scoring config.
	// Default is 10; see config/defaults.ts.
	// Why 10 and not 5 or 15?
	// - 10 balances penalty scaling: too low (e.g., 5) would make single issues tank scores in small projects, too high (e.g., 15+) would make penalties negligible.
	// - Empirical testing showed 10 keeps single-issue penalties proportional in small projects, but not negligible in large ones.
	const smoothingConstant = typeof smoothing === "number" ? smoothing : 10;
	const issueDensity = Math.min(
		1,
		diagnostics.length / (effectiveFileCount + smoothingConstant),
	);
	const scaledDeductions = deductions * Math.sqrt(issueDensity);

	// Logarithmic scaling: first issues matter most, score can't go below 0
	const score = Math.max(
		0,
		Math.round(
			PERFECT_SCORE -
				(PERFECT_SCORE * Math.log1p(scaledDeductions)) /
					Math.log1p(PERFECT_SCORE + scaledDeductions),
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
