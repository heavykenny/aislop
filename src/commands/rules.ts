import path from "node:path";
import { findConfigDir, RULES_FILE } from "../config/index.js";
import { loadArchitectureRules } from "../engines/architecture/rule-loader.js";
import { printCommandHeader } from "../output/layout.js";
import { highlighter } from "../utils/highlighter.js";
import { logger } from "../utils/logger.js";

const BUILTIN_RULES = [
	{
		engine: "format",
		rules: [
			"formatting",
			"import-order",
			"python-formatting",
			"go-formatting",
			"rust-formatting",
		],
	},
	{
		engine: "lint",
		rules: ["oxlint/*", "ruff/*", "go/*", "clippy/*", "rubocop/*"],
	},
	{
		engine: "code-quality",
		rules: [
			"knip/files",
			"knip/exports",
			"knip/types",
			"complexity/file-too-large",
			"complexity/function-too-long",
			"complexity/deep-nesting",
			"complexity/too-many-params",
		],
	},
	{
		engine: "ai-slop",
		rules: [
			"ai-slop/trivial-comment",
			"ai-slop/swallowed-exception",
			"ai-slop/thin-wrapper",
			"ai-slop/generic-naming",
		],
	},
	{
		engine: "security",
		rules: [
			"security/hardcoded-secret",
			"security/vulnerable-dependency",
			"security/eval",
			"security/innerhtml",
			"security/sql-injection",
			"security/shell-injection",
		],
	},
];

export const rulesCommand = async (directory: string): Promise<void> => {
	const resolvedDir = path.resolve(directory);

	printCommandHeader("Rules");

	logger.log("  Rule sets");
	logger.break();

	for (const { engine, rules } of BUILTIN_RULES) {
		logger.log(`  ${highlighter.bold(engine)}`);
		for (const rule of rules) {
			logger.dim(`    ${rule}`);
		}
		logger.break();
	}

	// Architecture rules
	const configDir = findConfigDir(resolvedDir);
	if (configDir) {
		const rulesPath = path.join(configDir, RULES_FILE);
		const archRules = loadArchitectureRules(rulesPath);
		if (archRules.length > 0) {
			logger.log(
				`  ${highlighter.bold("architecture")} (from .slop/rules.yml)`,
			);
			for (const rule of archRules) {
				logger.dim(`    arch/${rule.name} (${rule.severity})`);
			}
			logger.break();
		}
	}
};
