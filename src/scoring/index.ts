import type { Diagnostic } from "../engines/types.js";

export interface ScoreResult {
	score: number;
	label: string;
}

const PERFECT_SCORE = 100;

const PER_ENGINE_DEDUCTION_CAP = 25;

const FIXABLE_DISCOUNT = 0.5;

const getEffectiveFileCount = (diagnostics: Diagnostic[], sourceFileCount?: number): number => {
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

	// Group raw weighted contributions by engine so we can apply a per-engine cap.
	const byEngine = new Map<string, number>();
	for (const d of diagnostics) {
		const engineWeight = weights[d.engine] ?? 1.0;
		const severityPenalty = d.severity === "error" ? 3 : d.severity === "warning" ? 1 : 0.25;
		const fixableMultiplier = d.fixable ? FIXABLE_DISCOUNT : 1;
		const contribution = severityPenalty * engineWeight * fixableMultiplier;
		byEngine.set(d.engine, (byEngine.get(d.engine) ?? 0) + contribution);
	}

	let deductions = 0;
	for (const engineTotal of byEngine.values()) {
		deductions += Math.min(engineTotal, PER_ENGINE_DEDUCTION_CAP);
	}

	const effectiveFileCount = getEffectiveFileCount(diagnostics, sourceFileCount);
	// Smoothing scales with repo size so a 10k-file mature repo gets proportional
	// headroom instead of saturating density to 1 like a 50-file slop pile.
	const smoothingConstant =
		typeof smoothing === "number" ? smoothing : Math.max(10, effectiveFileCount * 0.3);
	const issueDensity = Math.min(1, diagnostics.length / (effectiveFileCount + smoothingConstant));
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
		score >= thresholds.good ? "Healthy" : score >= thresholds.ok ? "Needs Work" : "Critical";

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
