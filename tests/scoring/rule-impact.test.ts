import { describe, expect, it } from "vitest";
import { catalogRuleIds } from "../../src/commands/rules.js";
import {
	RULE_SCORE_IMPACTS,
	type RuleImpactTier,
	scoreImpactForRule,
} from "../../src/scoring/rule-impact.js";

const VALID_TIERS = new Set<RuleImpactTier>([
	"strict",
	"standard",
	"maintainability",
	"mechanical",
	"style",
	"advisory",
]);

describe("rule score impacts", () => {
	it("classifies every cataloged native rule explicitly", () => {
		const missing = catalogRuleIds()
			.filter((ruleId) => !RULE_SCORE_IMPACTS[ruleId])
			.sort();

		expect(
			missing,
			`native rule score impact(s) missing from src/scoring/rule-impact.ts: ${missing.join(", ")}`,
		).toEqual([]);
	});

	it("documents every explicit rule impact with valid scoring metadata", () => {
		for (const [ruleId, impact] of Object.entries(RULE_SCORE_IMPACTS)) {
			expect(VALID_TIERS.has(impact.tier), `${ruleId} has invalid tier`).toBe(true);
			expect(Number.isFinite(impact.multiplier), `${ruleId} has invalid multiplier`).toBe(true);
			expect(impact.multiplier, `${ruleId} multiplier must be positive`).toBeGreaterThan(0);
			expect(
				impact.multiplier,
				`${ruleId} multiplier should not exceed strict impact`,
			).toBeLessThanOrEqual(1);
			if (impact.cap !== undefined) {
				expect(Number.isFinite(impact.cap), `${ruleId} has invalid cap`).toBe(true);
				expect(impact.cap, `${ruleId} cap must be positive`).toBeGreaterThan(0);
			}
			expect(impact.rationale.trim().length, `${ruleId} needs a rationale`).toBeGreaterThan(20);
		}
	});

	it("orders forgiving and strict examples as intended", () => {
		expect(scoreImpactForRule("security/sql-injection").tier).toBe("strict");
		expect(scoreImpactForRule("ai-slop/hallucinated-import").tier).toBe("strict");
		expect(scoreImpactForRule("ai-slop/hardcoded-url").tier).toBe("advisory");
		expect(scoreImpactForRule("ai-slop/go-library-panic").tier).toBe("maintainability");
		expect(scoreImpactForRule("ai-slop/trivial-comment").tier).toBe("style");
		expect(scoreImpactForRule("ai-slop/unused-import").tier).toBe("mechanical");

		expect(scoreImpactForRule("security/sql-injection").multiplier).toBeGreaterThan(
			scoreImpactForRule("ai-slop/hardcoded-url").multiplier,
		);
	});

	it("uses wildcard profiles for external linter families", () => {
		expect(scoreImpactForRule("typescript/TS2322").tier).toBe("strict");
		expect(scoreImpactForRule("ruff/F401").tier).toBe("standard");
		expect(scoreImpactForRule("expo-doctor/dependency-version").tier).toBe("maintainability");
	});
});
