import path from "node:path";
import { findConfigDir, RULES_FILE } from "../config/index.js";
import { loadArchitectureRules } from "../engines/architecture/rule-loader.js";
import { printCommandHeader } from "../output/layout.js";

import { highlighter } from "../utils/highlighter.js";

const BUILTIN_RULES = [
	{
		engine: "format",
		rules: ["formatting", "import-order", "python-formatting", "go-formatting", "rust-formatting"],
	},
	{
		engine: "lint",
		rules: ["oxlint/*", "ruff/*", "go/*", "clippy/*", "rubocop/*"],
	},
	{
		engine: "code-quality",
		rules: [
			"knip/files",
			"knip/dependencies",
			"knip/devDependencies",
			"knip/unlisted",
			"knip/unresolved",
			"knip/binaries",
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
			"ai-slop/unused-import",
			"ai-slop/console-leftover",
			"ai-slop/todo-stub",
			"ai-slop/unreachable-code",
			"ai-slop/constant-condition",
			"ai-slop/empty-function",
			"ai-slop/unsafe-type-assertion",
			"ai-slop/double-type-assertion",
			"ai-slop/ts-directive",
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
	const lines = ["  Rule sets", ""];

	for (const { engine, rules } of BUILTIN_RULES) {
		lines.push(`  ${highlighter.bold(engine)}`);
		for (const rule of rules) {
			lines.push(highlighter.dim(`    ${rule}`));
		}
		lines.push("");
	}

	// Architecture rules
	const configDir = findConfigDir(resolvedDir);
	if (configDir) {
		const rulesPath = path.join(configDir, RULES_FILE);
		const archRules = loadArchitectureRules(rulesPath);
		if (archRules.length > 0) {
			lines.push(`  ${highlighter.bold("architecture")} (from .aislop/rules.yml)`);
			for (const rule of archRules) {
				lines.push(highlighter.dim(`    arch/${rule.name} (${rule.severity})`));
			}
			lines.push("");
		}
	}

	process.stdout.write(`${lines.join("\n")}\n`);
};
