import path from "node:path";
import { findConfigDir, RULES_FILE } from "../config/index.js";
import { loadArchitectureRules } from "../engines/architecture/rule-loader.js";
import { renderHeader } from "../ui/header.js";
import { detectInvocation } from "../ui/invocation.js";
import { renderHintLine } from "../ui/logger.js";
import { style, theme } from "../ui/theme.js";
import { padEnd } from "../ui/width.js";
import { APP_VERSION } from "../version.js";

interface RuleEntry {
	id: string;
	engine: string;
	severity: "error" | "warning" | "info";
	fixable: boolean;
}

interface BuildRulesRenderInput {
	rules: RuleEntry[];
	invocation?: string;
	printBrand?: boolean;
}

export const buildRulesRender = (input: BuildRulesRenderInput): string => {
	const header = renderHeader({
		version: APP_VERSION,
		command: "rules",
		context: [],
		brand: input.printBrand !== false,
	});
	const byEngine = new Map<string, RuleEntry[]>();
	for (const r of input.rules) {
		const list = byEngine.get(r.engine) ?? [];
		list.push(r);
		byEngine.set(r.engine, list);
	}

	const engines = [...byEngine.keys()].sort();
	const idWidth = Math.max(20, ...input.rules.map((r) => r.id.length));

	const lines: string[] = [];
	for (const engine of engines) {
		lines.push(` ${style(theme, "accent", engine)}`);
		const rules = (byEngine.get(engine) ?? []).sort((a, b) => a.id.localeCompare(b.id));
		for (const r of rules) {
			const severity = style(
				theme,
				r.severity === "error" ? "danger" : "warn",
				padEnd(r.severity, 8),
			);
			const fixable = r.fixable
				? style(theme, "accent", "fixable")
				: style(theme, "muted", "manual");
			lines.push(`   ${padEnd(r.id, idWidth)}  ${severity}  ${fixable}`);
		}
		lines.push("");
	}

	const invocation = input.invocation ?? detectInvocation();
	const tail =
		renderHintLine(`Run ${invocation} scan to apply these rules`) +
		renderHintLine(`Run ${invocation} init to customize which engines are enabled`);

	return `${header}${lines.join("\n")}\n${tail}`;
};

const AI_SLOP_FIXABLE = new Set<string>([
	"ai-slop/trivial-comment",
	"ai-slop/unused-import",
	"ai-slop/narrative-comment",
]);

const BUILTIN_RULES: { engine: string; rules: string[] }[] = [
	{
		engine: "format",
		rules: [
			"formatting",
			"import-order",
			"python-formatting",
			"go-formatting",
			"rust-formatting",
			"ruby-formatting",
			"php-formatting",
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
			"ai-slop/narrative-comment",
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

const toRuleEntry = (engine: string, ruleId: string): RuleEntry => {
	if (engine === "format") {
		return { id: ruleId, engine, severity: "warning", fixable: true };
	}
	if (engine === "security") {
		return { id: ruleId, engine, severity: "error", fixable: false };
	}
	if (engine === "ai-slop") {
		return {
			id: ruleId,
			engine,
			severity: "warning",
			fixable: AI_SLOP_FIXABLE.has(ruleId),
		};
	}
	// lint, code-quality
	return { id: ruleId, engine, severity: "warning", fixable: false };
};

interface RulesOptions {
	printBrand?: boolean;
}

export const rulesCommand = async (
	directory: string,
	options: RulesOptions = {},
): Promise<void> => {
	const resolvedDir = path.resolve(directory);

	const entries: RuleEntry[] = [];
	for (const { engine, rules } of BUILTIN_RULES) {
		for (const rule of rules) {
			entries.push(toRuleEntry(engine, rule));
		}
	}

	const configDir = findConfigDir(resolvedDir);
	if (configDir) {
		const rulesPath = path.join(configDir, RULES_FILE);
		const archRules = loadArchitectureRules(rulesPath);
		for (const rule of archRules) {
			entries.push({
				id: `arch/${rule.name}`,
				engine: "architecture",
				severity: rule.severity,
				fixable: false,
			});
		}
	}

	process.stdout.write(
		`${buildRulesRender({
			rules: entries,
			invocation: detectInvocation(),
			printBrand: options.printBrand,
		})}\n`,
	);
};
