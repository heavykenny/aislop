import type { Diagnostic } from "../engines/types.js";
import { scoreImpactForRule } from "./rule-impact.js";

export interface ScoreResult {
	score: number;
	label: string;
	effectiveSourceFileCount?: number;
	sourceFileCountMode?: "provided" | "estimated-from-diagnostics" | "not-needed";
}

const PERFECT_SCORE = 100;
type ResolvedFileCount = {
	effectiveSourceFileCount: number;
	sourceFileCountMode: "provided" | "estimated-from-diagnostics";
};

const resolveEffectiveFileCount = (
	diagnostics: Diagnostic[],
	sourceFileCount?: number,
): ResolvedFileCount => {
	if (typeof sourceFileCount === "number" && sourceFileCount > 0) {
		return { effectiveSourceFileCount: sourceFileCount, sourceFileCountMode: "provided" };
	}
	if (typeof sourceFileCount === "number" && sourceFileCount < 0) {
		throw new Error("sourceFileCount cannot be negative.");
	}

	const observedDiagnosticFiles = new Set(diagnostics.map((d) => d.filePath).filter(Boolean)).size;
	if (observedDiagnosticFiles === 0) {
		throw new Error("Cannot score diagnostics without sourceFileCount or diagnostic file paths.");
	}

	return {
		effectiveSourceFileCount: observedDiagnosticFiles,
		sourceFileCountMode: "estimated-from-diagnostics",
	};
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
		return { score: PERFECT_SCORE, label: "Healthy", sourceFileCountMode: "not-needed" };
	}

	const deductionsByRule = new Map<string, number>();

	for (const d of diagnostics) {
		const engineWeight = weights[d.engine] ?? 1.0;
		const severityPenalty = d.severity === "error" ? 3 : d.severity === "warning" ? 1 : 0.25;
		const ruleImpact = scoreImpactForRule(d.rule);
		const key = `${d.engine}:${d.rule}`;
		deductionsByRule.set(
			key,
			(deductionsByRule.get(key) ?? 0) + severityPenalty * engineWeight * ruleImpact.multiplier,
		);
	}
	const defaultRuleCap = typeof maxPerRule === "number" && maxPerRule > 0 ? maxPerRule : null;
	const capForRule = (key: string): number | null => {
		const rule = key.slice(key.indexOf(":") + 1);
		const ruleCap = scoreImpactForRule(rule).cap;
		if (typeof ruleCap === "number") {
			return defaultRuleCap ? Math.min(defaultRuleCap, ruleCap) : ruleCap;
		}
		return defaultRuleCap;
	};
	const deductions = [...deductionsByRule.entries()].reduce((total, [key, value]) => {
		const cap = capForRule(key);
		return total + (cap ? Math.min(value, cap) : value);
	}, 0);

	const fileCount = resolveEffectiveFileCount(diagnostics, sourceFileCount);
	const smoothingConstant = typeof smoothing === "number" ? smoothing : 10;
	const issueDensity = Math.min(
		1,
		diagnostics.length / (fileCount.effectiveSourceFileCount + smoothingConstant),
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
		score >= thresholds.good ? "Healthy" : score >= thresholds.ok ? "Needs Work" : "Critical";

	return { score, label, ...fileCount };
};

export const getScoreColor = (
	score: number,
	thresholds: { good: number; ok: number },
): "success" | "warn" | "error" => {
	if (score >= thresholds.good) return "success";
	if (score >= thresholds.ok) return "warn";
	return "error";
};
