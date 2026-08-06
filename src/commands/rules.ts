import path from "node:path";
import { findConfigDir, RULES_FILE } from "../config/index.js";
import { loadArchitectureRules } from "../engines/architecture/rule-loader.js";
import { descriptionForRule } from "../output/rule-labels.js";
import { detectInvocation } from "../ui/invocation.js";
import { searchSelect } from "../ui/search-select.js";
import { toRuleEntry } from "./rules-entry.js";
import {
	buildRuleDetailRender,
	buildRulesRender,
	fixModeLabel,
	presentationFor,
	type RuleEntry,
	severityLabel,
} from "./rules-render.js";

export { buildRuleDetailRender, buildRulesRender } from "./rules-render.js";

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
			"csharp-formatting",
			"cpp-formatting",
		],
	},
	{
		engine: "lint",
		rules: [
			"oxlint/*",
			"ruff/*",
			"go/*",
			"clippy/*",
			"rubocop/*",
			"typescript/*",
			"dotnet/*",
			"cppcheck/*",
			"clang-tidy/*",
		],
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
			"knip/duplicates",
			"code-quality/duplicate-block",
			"code-quality/repeated-chained-call",
			"code-quality/unused-declaration",
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
			"ai-slop/silent-recovery",
			"ai-slop/meta-comment",
			"ai-slop/hidden-fallback",
			"ai-slop/redundant-try-catch",
			"ai-slop/redundant-type-coercion",
			"ai-slop/duplicate-type-declaration",
			"ai-slop/thin-wrapper",
			"ai-slop/generic-naming",
			"ai-slop/unused-import",
			"ai-slop/unused-css",
			"ai-slop/console-leftover",
			"ai-slop/todo-stub",
			"ai-slop/unreachable-code",
			"ai-slop/constant-condition",
			"ai-slop/empty-function",
			"ai-slop/unsafe-type-assertion",
			"ai-slop/double-type-assertion",
			"ai-slop/ts-directive",
			"ai-slop/narrative-comment",
			"ai-slop/duplicate-import",
			"ai-slop/hardcoded-url",
			"ai-slop/hardcoded-id",
			"ai-slop/python-bare-except",
			"ai-slop/python-broad-except",
			"ai-slop/python-mutable-default",
			"ai-slop/python-print-debug",
			"ai-slop/python-range-len-loop",
			"ai-slop/python-chained-dict-get",
			"ai-slop/python-repetitive-dispatch",
			"ai-slop/python-isinstance-ladder",
			"ai-slop/go-library-panic",
			"ai-slop/rust-non-test-unwrap",
			"ai-slop/rust-todo-stub",
			"ai-slop/hallucinated-import",
			"ai-slop/tautological-test",
			"ai-slop/csharp-not-implemented",
			"ai-slop/csharp-redundant-doc-comment",
			"ai-slop/csharp-async-void",
			"ai-slop/csharp-sync-over-async",
			"ai-slop/csharp-suppressed-warning",
			"ai-slop/csharp-empty-catch-rethrow",
			"ai-slop/csharp-null-forgiving",
			"ai-slop/csharp-console-leftover",
			"ai-slop/csharp-broad-catch",
			"ai-slop/csharp-linq-count",
			"ai-slop/csharp-index-loop",
			"ai-slop/csharp-if-ladder",
			"ai-slop/csharp-string-concat-in-loop",
			"ai-slop/cpp-not-implemented",
			"ai-slop/cpp-using-namespace-std-in-header",
			"ai-slop/cpp-c-style-cast",
			"ai-slop/cpp-manual-delete",
			"ai-slop/cpp-iostream-leftover",
			"ai-slop/cpp-null-literal",
			"ai-slop/cpp-define-constant",
			"ai-slop/cpp-endl-in-stream",
		],
	},
	{
		engine: "security",
		rules: [
			"security/hardcoded-secret",
			"security/vulnerable-dependency",
			"security/eval",
			"security/innerhtml",
			"security/dangerously-set-innerhtml",
			"security/sql-injection",
			"security/shell-injection",
			"security/unsafe-deserialization",
			"security/unsafe-c-call",
			"security/dependency-audit-skipped",
		],
	},
];

// The native rule IDs the catalog advertises (excludes lint/format wildcards).
export const catalogRuleIds = (): string[] =>
	BUILTIN_RULES.flatMap((b) => b.rules).filter((id) =>
		/^(?:ai-slop|complexity|security|code-quality|knip)\/[a-zA-Z0-9-]+$/.test(id),
	);

interface RulesOptions {
	printBrand?: boolean;
	interactive?: boolean;
}

const collectRuleEntries = (directory: string): RuleEntry[] => {
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

	return entries;
};

const runRulesExplorer = async (entries: RuleEntry[], options: RulesOptions): Promise<void> => {
	const selected = await searchSelect<RuleEntry>({
		message: "Search rules",
		items: entries.map((rule) => {
			const presentation = presentationFor(rule.engine);
			return {
				value: rule,
				label: rule.id,
				hint: `${presentation.label} · ${severityLabel(rule.severity)} · ${descriptionForRule(rule.id)}`,
				keywords: [
					presentation.label,
					rule.engine,
					rule.severity,
					fixModeLabel(rule.fixable),
					descriptionForRule(rule.id),
				],
			};
		}),
		maxVisible: 10,
		required: true,
	});
	if (selected === null) return;
	process.stdout.write(
		`${buildRuleDetailRender(selected, {
			printBrand: options.printBrand,
			includeHeader: true,
		})}\n`,
	);
};

export const rulesCommand = async (
	directory: string,
	options: RulesOptions = {},
): Promise<void> => {
	const entries = collectRuleEntries(directory);

	if (options.interactive && process.stdin.isTTY && process.stdout.isTTY) {
		await runRulesExplorer(entries, options);
		return;
	}

	process.stdout.write(
		`${buildRulesRender({
			rules: entries,
			invocation: detectInvocation(),
			printBrand: options.printBrand,
		})}\n`,
	);
};
