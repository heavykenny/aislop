import type { Diagnostic } from "../engines/types.js";

export interface ScoreResult {
	score: number;
	label: string;
}

const PERFECT_SCORE = 100;

// Style rules weigh half on the score so genuine slop drives it, not house style.
const STYLE_RULES = new Set([
	"ai-slop/trivial-comment",
	"ai-slop/narrative-comment",
	"complexity/file-too-large",
	"complexity/function-too-long",
]);
const STYLE_WEIGHT = 0.5;
const COMMENT_STYLE_RULE_CAP = 12;
const COMMENT_STYLE_RULES = new Set(["ai-slop/trivial-comment", "ai-slop/narrative-comment"]);

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
	maxPerRule?: number,
): ScoreResult => {
	if (diagnostics.length === 0) {
		return { score: PERFECT_SCORE, label: "Healthy" };
	}

	const deductionsByRule = new Map<string, number>();

	for (const d of diagnostics) {
		const engineWeight = weights[d.engine] ?? 1.0;
		const severityPenalty = d.severity === "error" ? 3 : d.severity === "warning" ? 1 : 0.25;
		const styleFactor = STYLE_RULES.has(d.rule) ? STYLE_WEIGHT : 1;
		const key = `${d.engine}:${d.rule}`;
		deductionsByRule.set(
			key,
			(deductionsByRule.get(key) ?? 0) + severityPenalty * engineWeight * styleFactor,
		);
	}
	const defaultRuleCap = typeof maxPerRule === "number" && maxPerRule > 0 ? maxPerRule : null;
	const capForRule = (key: string): number | null => {
		const rule = key.slice(key.indexOf(":") + 1);
		if (COMMENT_STYLE_RULES.has(rule)) {
			return defaultRuleCap
				? Math.min(defaultRuleCap, COMMENT_STYLE_RULE_CAP)
				: COMMENT_STYLE_RULE_CAP;
		}
		return defaultRuleCap;
	};
	const deductions = [...deductionsByRule.entries()].reduce((total, [key, value]) => {
		const cap = capForRule(key);
		return total + (cap ? Math.min(value, cap) : value);
	}, 0);

	const effectiveFileCount = getEffectiveFileCount(diagnostics, sourceFileCount);
	const smoothingConstant = typeof smoothing === "number" ? smoothing : 10;
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
