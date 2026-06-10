import path from "node:path";
import { findConfigDir, RULES_FILE } from "../config/index.js";
import { loadArchitectureRules } from "../engines/architecture/rule-loader.js";
import { descriptionForRule } from "../output/rule-labels.js";
import { scoreImpactForRule } from "../scoring/rule-impact.js";
import { highlightAislop } from "../ui/brand.js";
import { renderHeader } from "../ui/header.js";
import { detectInvocation } from "../ui/invocation.js";
import { renderHintLine } from "../ui/logger.js";
import { searchSelect } from "../ui/search-select.js";
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
	includeHeader?: boolean;
}

const ENGINE_PRESENTATION: Record<string, { label: string; summary: string; order: number }> = {
	"ai-slop": {
		label: "AI Slop",
		summary: "Generated-code leftovers: vague comments, unsafe casts, stubs, swallowed errors.",
		order: 10,
	},
	security: {
		label: "Security",
		summary: "Secrets, injection, XSS, shell execution, and vulnerable dependencies.",
		order: 20,
	},
	"code-quality": {
		label: "Code Quality",
		summary: "Dead code, duplicate code, complexity, and dependency hygiene.",
		order: 30,
	},
	format: {
		label: "Format",
		summary: "Formatter and import-order checks that aislop can usually fix.",
		order: 40,
	},
	lint: {
		label: "Lint",
		summary: "Language linter and compiler findings from bundled or system tools.",
		order: 50,
	},
	architecture: {
		label: "Architecture",
		summary: "Project-specific import and layering rules from .aislop/rules.yml.",
		order: 60,
	},
};

const presentationFor = (engine: string): { label: string; summary: string; order: number } =>
	ENGINE_PRESENTATION[engine] ?? {
		label: engine,
		summary: "Project-specific rules.",
		order: 100,
	};

const severityLabel = (severity: RuleEntry["severity"]): string =>
	severity === "warning" ? "warn" : severity;

const fixModeLabel = (fixable: boolean): "auto" | "review" => (fixable ? "auto" : "review");

const impactLabel = (ruleId: string): string => scoreImpactForRule(ruleId).tier;

export const buildRulesRender = (input: BuildRulesRenderInput): string => {
	const header =
		input.includeHeader === false
			? ""
			: renderHeader({
					version: APP_VERSION,
					command: "Rules catalog",
					context: [`${input.rules.length} checks`],
					brand: input.printBrand !== false,
				});
	const byEngine = new Map<string, RuleEntry[]>();
	for (const r of input.rules) {
		const list = byEngine.get(r.engine) ?? [];
		list.push(r);
		byEngine.set(r.engine, list);
	}

	const engines = [...byEngine.keys()].sort((a, b) => {
		const pa = presentationFor(a);
		const pb = presentationFor(b);
		if (pa.order !== pb.order) return pa.order - pb.order;
		return pa.label.localeCompare(pb.label);
	});
	const idWidth = Math.max(20, ...input.rules.map((r) => r.id.length));

	const lines: string[] = [
		` ${style(theme, "muted", "auto = aislop fix can change it; review = inspect and fix with a developer or agent.")}`,
		` ${style(theme, "muted", "impact = how strongly the finding contributes to the score.")}`,
		"",
	];
	for (const engine of engines) {
		const presentation = presentationFor(engine);
		lines.push(` ${style(theme, "accent", presentation.label)}`);
		lines.push(`   ${style(theme, "muted", presentation.summary)}`);
		lines.push(
			`   ${style(theme, "dim", padEnd("Rule ID", idWidth))}  ${style(theme, "dim", "Sev")}    ${style(theme, "dim", "Fix")}     ${style(theme, "dim", "Impact")}          ${style(theme, "dim", "Meaning")}`,
		);
		const rules = (byEngine.get(engine) ?? []).sort((a, b) => a.id.localeCompare(b.id));
		for (const r of rules) {
			const severityText = severityLabel(r.severity);
			const severity = style(
				theme,
				r.severity === "error" ? "danger" : "warn",
				padEnd(severityText, 5),
			);
			const fixable = r.fixable
				? style(theme, "accent", padEnd("auto", 6))
				: style(theme, "muted", padEnd("review", 6));
			const impact = style(theme, "muted", padEnd(impactLabel(r.id), 15));
			lines.push(
				`   ${padEnd(r.id, idWidth)}  ${severity}  ${fixable}  ${impact}  ${descriptionForRule(r.id)}`,
			);
		}
		lines.push("");
	}

	const invocation = input.invocation ?? detectInvocation();
	const tail =
		renderHintLine(`Run ${invocation} scan to check your project against these rules`) +
		renderHintLine(`Run ${invocation} init to choose engines and CI settings`);

	return `${header}${lines.join("\n")}\n${tail}`;
};

export const buildRuleDetailRender = (
	rule: RuleEntry,
	input: { printBrand?: boolean; includeHeader?: boolean } = {},
): string => {
	const presentation = presentationFor(rule.engine);
	const header =
		input.includeHeader === false
			? ""
			: renderHeader({
					version: APP_VERSION,
					command: "Rule detail",
					context: [presentation.label],
					brand: input.printBrand !== false,
				});
	const rows = [
		["Rule", rule.id],
		["Engine", `${presentation.label} — ${presentation.summary}`],
		["Severity", severityLabel(rule.severity)],
		[
			"Fix",
			`${fixModeLabel(rule.fixable)}${rule.fixable ? " (aislop fix can change it)" : " (review and fix intentionally)"}`,
		],
		["Impact", `${impactLabel(rule.id)} — ${scoreImpactForRule(rule.id).rationale}`],
		["Meaning", descriptionForRule(rule.id)],
	];
	const labelWidth = Math.max(...rows.map(([label]) => label.length));
	const body = rows
		.map(([label, value]) => {
			const valueToken = label === "Severity" && rule.severity === "error" ? "danger" : "fg";
			return ` ${style(theme, "muted", padEnd(label, labelWidth))}  ${highlightAislop(value, theme, valueToken)}`;
		})
		.join("\n");
	const tail = renderHintLine(
		rule.fixable
			? "Run aislop fix to apply the automatic fix"
			: "Use the meaning above to fix or review the finding",
	);
	return `${header}${body}\n\n${tail}`;
};

const AI_SLOP_FIXABLE = new Set<string>([
	"ai-slop/trivial-comment",
	"ai-slop/unused-import",
	"ai-slop/narrative-comment",
	"ai-slop/duplicate-import",
]);

const AI_SLOP_ERRORS = new Set<string>(["ai-slop/hallucinated-import"]);

const SECURITY_INFO = new Set<string>(["security/dependency-audit-skipped"]);

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
		rules: ["oxlint/*", "ruff/*", "go/*", "clippy/*", "rubocop/*", "typescript/*"],
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
			"ai-slop/redundant-try-catch",
			"ai-slop/redundant-type-coercion",
			"ai-slop/duplicate-type-declaration",
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
			"security/dependency-audit-skipped",
		],
	},
];

// The native rule IDs the catalog advertises (excludes lint/format wildcards).
export const catalogRuleIds = (): string[] =>
	BUILTIN_RULES.flatMap((b) => b.rules).filter((id) =>
		/^(?:ai-slop|complexity|security|code-quality|knip)\/[a-zA-Z0-9-]+$/.test(id),
	);

const toRuleEntry = (engine: string, ruleId: string): RuleEntry => {
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
	// lint, code-quality
	return { id: ruleId, engine, severity: "warning", fixable: false };
};

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
