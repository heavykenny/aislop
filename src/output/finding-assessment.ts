import type { Diagnostic } from "../engines/types.js";
import { type RuleScoreImpact, scoreImpactForRule } from "../scoring/rule-impact.js";

export type FindingKind =
	| "confirmed-defect"
	| "conservative-security"
	| "style-policy"
	| "ai-slop-indicator";

export type FindingConfidence = "high" | "medium" | "low";

export interface FindingAssessment {
	kind: FindingKind;
	confidence: FindingConfidence;
	label: string;
}

export interface AssessedDiagnostic extends Diagnostic {
	assessment: FindingAssessment;
	scoreImpact: RuleScoreImpact;
	forceFixable: boolean;
}

const KNIP_FORCE_RULES = new Set(["knip/files", "knip/dependencies", "knip/devDependencies"]);

export const isForceFixable = (diagnostic: Diagnostic): boolean => {
	if (diagnostic.fixable) return false;
	if (KNIP_FORCE_RULES.has(diagnostic.rule)) return true;
	// Only JS audits have a `fix -f` path; pip/govulncheck/cargo do not.
	if (diagnostic.rule === "security/vulnerable-dependency") {
		return diagnostic.detail === "npm" || diagnostic.detail === "pnpm";
	}
	if (diagnostic.rule.startsWith("expo-doctor/")) {
		return diagnostic.rule !== "expo-doctor/config-error";
	}
	return false;
};

export interface FindingAssessmentRow {
	kind: FindingKind;
	label: string;
	count: number;
	errors: number;
	warnings: number;
	info: number;
	fixable: number;
}

export interface FindingAssessmentSummary {
	rows: FindingAssessmentRow[];
	byKind: Record<FindingKind, number>;
	byConfidence: Record<FindingConfidence, number>;
}

const FINDING_KIND_LABELS: Record<FindingKind, string> = {
	"confirmed-defect": "confirmed defects",
	"conservative-security": "conservative security",
	"style-policy": "style/policy",
	"ai-slop-indicator": "AI-slop indicators",
};

const STYLE_POLICY_RULES = new Set([
	"ai-slop/trivial-comment",
	"ai-slop/narrative-comment",
	"ai-slop/meta-comment",
	"ai-slop/console-leftover",
	"ai-slop/ts-directive",
	"complexity/file-too-large",
	"complexity/function-too-long",
	"complexity/deep-nesting",
	"complexity/too-many-params",
	"code-quality/duplicate-block",
	"eslint/no-empty",
	"eslint/no-unused-vars",
	"eslint/no-useless-escape",
	"eslint/no-unused-expressions",
	"unicorn/no-useless-fallback-in-spread",
	"unicorn/prefer-string-starts-ends-with",
	"unicorn/no-new-array",
	"unicorn/no-useless-spread",
]);

const CONFIRMED_DEFECT_RULES = new Set([
	"ai-slop/hallucinated-import",
	"eslint/no-undef",
	"eslint/no-unreachable",
	"security/vulnerable-dependency",
]);

const LOW_CONFIDENCE_SECURITY_RULES = new Set([
	"security/innerhtml",
	"security/dangerously-set-innerhtml",
]);

const confidenceFor = (diagnostic: Diagnostic, kind: FindingKind): FindingConfidence => {
	if (kind === "confirmed-defect") return "high";
	if (kind === "style-policy") return "medium";
	if (kind === "conservative-security") {
		if (LOW_CONFIDENCE_SECURITY_RULES.has(diagnostic.rule)) return "medium";
		return diagnostic.severity === "error" ? "high" : "medium";
	}
	return diagnostic.severity === "error" ? "high" : "medium";
};

const classifyKind = (diagnostic: Diagnostic): FindingKind => {
	if (CONFIRMED_DEFECT_RULES.has(diagnostic.rule)) return "confirmed-defect";
	if (diagnostic.engine === "security") return "conservative-security";
	if (STYLE_POLICY_RULES.has(diagnostic.rule)) return "style-policy";
	if (diagnostic.engine === "format" || diagnostic.engine === "code-quality") return "style-policy";
	if (diagnostic.engine === "ai-slop") return "ai-slop-indicator";
	if (diagnostic.severity === "error") return "confirmed-defect";
	return "style-policy";
};

export const assessDiagnostic = (diagnostic: Diagnostic): FindingAssessment => {
	const kind = classifyKind(diagnostic);
	return {
		kind,
		confidence: confidenceFor(diagnostic, kind),
		label: FINDING_KIND_LABELS[kind],
	};
};

export const withFindingAssessments = (diagnostics: Diagnostic[]): AssessedDiagnostic[] =>
	diagnostics.map((diagnostic) => ({
		...diagnostic,
		assessment: assessDiagnostic(diagnostic),
		scoreImpact: scoreImpactForRule(diagnostic.rule),
		forceFixable: isForceFixable(diagnostic),
	}));

export const summarizeFindingAssessments = (
	diagnostics: Diagnostic[],
): FindingAssessmentSummary => {
	const byKind: Record<FindingKind, number> = {
		"confirmed-defect": 0,
		"conservative-security": 0,
		"style-policy": 0,
		"ai-slop-indicator": 0,
	};
	const byConfidence: Record<FindingConfidence, number> = {
		high: 0,
		medium: 0,
		low: 0,
	};
	const rows = new Map<FindingKind, FindingAssessmentRow>();

	for (const diagnostic of diagnostics) {
		const assessment = assessDiagnostic(diagnostic);
		byKind[assessment.kind]++;
		byConfidence[assessment.confidence]++;
		const row = rows.get(assessment.kind) ?? {
			kind: assessment.kind,
			label: assessment.label,
			count: 0,
			errors: 0,
			warnings: 0,
			info: 0,
			fixable: 0,
		};
		row.count++;
		if (diagnostic.severity === "error") row.errors++;
		else if (diagnostic.severity === "warning") row.warnings++;
		else row.info++;
		if (diagnostic.fixable) row.fixable++;
		rows.set(assessment.kind, row);
	}

	return {
		rows: [...rows.values()].sort((a, b) => b.count - a.count),
		byKind,
		byConfidence,
	};
};
