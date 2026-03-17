import type { EngineName } from "../engines/types.js";

export interface EngineInfo {
	label: string;
	description: string;
}

export const ENGINE_INFO: Record<EngineName, EngineInfo> = {
	format: {
		label: "Formatting",
		description: "Whitespace, indentation, line wrapping, and import ordering",
	},
	lint: {
		label: "Linting",
		description: "Static analysis for likely bugs and bad patterns",
	},
	"code-quality": {
		label: "Code Quality",
		description: "Complexity limits, dead code detection, and duplication checks",
	},
	"ai-slop": {
		label: "Maintainability",
		description: "Over-abstraction, swallowed errors, and low-signal code patterns",
	},
	architecture: {
		label: "Architecture",
		description: "Project-specific import and layering rules",
	},
	security: {
		label: "Security",
		description: "Secret leaks, risky APIs, and dependency vulnerabilities",
	},
};

export const getEngineLabel = (engine: EngineName): string => ENGINE_INFO[engine].label;
