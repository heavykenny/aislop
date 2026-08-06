export type RuleImpactTier =
	| "strict"
	| "standard"
	| "maintainability"
	| "mechanical"
	| "style"
	| "advisory";

export interface RuleScoreImpact {
	tier: RuleImpactTier;
	multiplier: number;
	cap?: number;
	rationale: string;
}
