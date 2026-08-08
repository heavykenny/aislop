import type { RuleScoreImpact } from "./rule-impact-types.js";

export const strict = (rationale: string): RuleScoreImpact => ({
	tier: "strict",
	multiplier: 1,
	rationale,
});

export const standard = (rationale: string): RuleScoreImpact => ({
	tier: "standard",
	multiplier: 1,
	rationale,
});

export const maintainability = (rationale: string, cap = 24): RuleScoreImpact => ({
	tier: "maintainability",
	multiplier: 0.75,
	cap,
	rationale,
});

export const mechanical = (rationale: string, cap = 16): RuleScoreImpact => ({
	tier: "mechanical",
	multiplier: 0.5,
	cap,
	rationale,
});

export const style = (rationale: string, cap = 8): RuleScoreImpact => ({
	tier: "style",
	multiplier: 0.5,
	cap,
	rationale,
});

export const advisory = (rationale: string, cap = 8): RuleScoreImpact => ({
	tier: "advisory",
	multiplier: 0.25,
	cap,
	rationale,
});
