import type { RuleEntry } from "./rules-render.js";

const AI_SLOP_FIXABLE = new Set<string>([
	"ai-slop/trivial-comment",
	"ai-slop/unused-import",
	"ai-slop/narrative-comment",
	"ai-slop/duplicate-import",
]);

const AI_SLOP_ERRORS = new Set<string>(["ai-slop/hallucinated-import"]);

const SECURITY_INFO = new Set<string>(["security/dependency-audit-skipped"]);

export const toRuleEntry = (engine: string, ruleId: string): RuleEntry => {
	if (engine === "format") {
		return { id: ruleId, engine, severity: "warning", fixable: true };
	}
	if (engine === "security") {
		return {
			id: ruleId,
			engine,
			severity: SECURITY_INFO.has(ruleId) ? "info" : "error",
			fixable: false,
		};
	}
	if (engine === "ai-slop") {
		return {
			id: ruleId,
			engine,
			severity: AI_SLOP_ERRORS.has(ruleId) ? "error" : "warning",
			fixable: AI_SLOP_FIXABLE.has(ruleId),
		};
	}
	return { id: ruleId, engine, severity: "warning", fixable: false };
};
