import { AI_SLOP_RULE_SCORE_IMPACTS } from "./rule-impact-ai-slop.js";
import { maintainability, standard, strict } from "./rule-impact-builders.js";
import { CORE_RULE_SCORE_IMPACTS } from "./rule-impact-core.js";
import type { RuleScoreImpact } from "./rule-impact-types.js";

export type { RuleImpactTier, RuleScoreImpact } from "./rule-impact-types.js";

export const RULE_SCORE_IMPACTS: Record<string, RuleScoreImpact> = {
	...CORE_RULE_SCORE_IMPACTS,
	...AI_SLOP_RULE_SCORE_IMPACTS,
};

const DEFAULT_IMPACT: RuleScoreImpact = standard(
	"Unclassified external rule uses standard impact.",
);

const WILDCARD_RULE_SCORE_IMPACTS: Array<[prefix: string, impact: RuleScoreImpact]> = [
	["oxlint/", standard("External oxlint rule uses standard lint impact.")],
	["ruff/", standard("External ruff rule uses standard lint impact.")],
	["go/", standard("External Go lint rule uses standard lint impact.")],
	["clippy/", standard("External clippy rule uses standard lint impact.")],
	["rubocop/", standard("External rubocop rule uses standard lint impact.")],
	["typescript/", strict("TypeScript compiler diagnostics can break builds.")],
	["expo-doctor/", maintainability("Expo Doctor findings are project-configuration hygiene.")],
];

export const scoreImpactForRule = (ruleId: string): RuleScoreImpact =>
	RULE_SCORE_IMPACTS[ruleId] ??
	WILDCARD_RULE_SCORE_IMPACTS.find(([prefix]) => ruleId.startsWith(prefix))?.[1] ??
	DEFAULT_IMPACT;
