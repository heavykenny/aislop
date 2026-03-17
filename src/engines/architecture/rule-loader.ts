import fs from "node:fs";
import YAML from "yaml";
import type { Severity } from "../types.js";

export interface ArchitectureRule {
	name: string;
	type: "forbid_import" | "forbid_import_from_path" | "require_pattern";
	match?: string;
	from?: string;
	forbid?: string;
	pattern?: string;
	where?: string;
	severity: Severity;
}

interface RulesFile {
	rules?: ArchitectureRule[];
}

export const loadArchitectureRules = (rulesPath: string): ArchitectureRule[] => {
	if (!fs.existsSync(rulesPath)) return [];

	try {
		const content = fs.readFileSync(rulesPath, "utf-8");
		const parsed = YAML.parse(content) as RulesFile;
		return parsed?.rules ?? [];
	} catch {
		return [];
	}
};
