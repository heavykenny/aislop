import type { Engine, EngineContext, EngineResult } from "../types.js";
import { checkRules } from "./matchers.js";
import { loadArchitectureRules } from "./rule-loader.js";

export const architectureEngine: Engine = {
	name: "architecture",

	async run(context: EngineContext): Promise<EngineResult> {
		if (!context.config.architectureRulesPath) {
			return {
				engine: "architecture",
				diagnostics: [],
				elapsed: 0,
				skipped: true,
				skipReason: "No architecture rules configured",
			};
		}

		const rules = loadArchitectureRules(context.config.architectureRulesPath);
		if (rules.length === 0) {
			return {
				engine: "architecture",
				diagnostics: [],
				elapsed: 0,
				skipped: true,
				skipReason: "No rules found in rules file",
			};
		}

		const diagnostics = await checkRules(context, rules);

		return {
			engine: "architecture",
			diagnostics,
			elapsed: 0,
			skipped: false,
		};
	},
};
