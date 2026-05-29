import type { RuleSeverity } from "../config/schema.js";
import type { Diagnostic } from "../engines/types.js";

/**
 * Apply per-rule severity overrides from config: "off" drops the diagnostic,
 * "error"/"warning" rewrite its severity before scoring and rendering.
 */
export const applyRuleSeverities = (
	diagnostics: Diagnostic[],
	overrides: Record<string, RuleSeverity>,
): Diagnostic[] => {
	if (Object.keys(overrides).length === 0) return diagnostics;

	const result: Diagnostic[] = [];
	for (const diagnostic of diagnostics) {
		const override = overrides[diagnostic.rule];
		if (!override) {
			result.push(diagnostic);
			continue;
		}
		if (override === "off") continue;
		result.push(
			override === diagnostic.severity ? diagnostic : { ...diagnostic, severity: override },
		);
	}
	return result;
};
