import { descriptionForRule } from "../output/rule-labels.js";
import { scoreImpactForRule } from "../scoring/rule-impact.js";
import { highlightAislop } from "../ui/brand.js";
import { renderHeader } from "../ui/header.js";
import { detectInvocation } from "../ui/invocation.js";
import { renderHintLine } from "../ui/logger.js";
import { style, theme } from "../ui/theme.js";
import { padEnd } from "../ui/width.js";
import { APP_VERSION } from "../version.js";

export interface RuleEntry {
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

export const presentationFor = (
	engine: string,
): { label: string; summary: string; order: number } =>
	ENGINE_PRESENTATION[engine] ?? {
		label: engine,
		summary: "Project-specific rules.",
		order: 100,
	};

export const severityLabel = (severity: RuleEntry["severity"]): string =>
	severity === "warning" ? "warn" : severity;

export const fixModeLabel = (fixable: boolean): "auto" | "review" => (fixable ? "auto" : "review");

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
		["Engine", `${presentation.label} - ${presentation.summary}`],
		["Severity", severityLabel(rule.severity)],
		[
			"Fix",
			`${fixModeLabel(rule.fixable)}${rule.fixable ? " (aislop fix can change it)" : " (review and fix intentionally)"}`,
		],
		["Impact", `${impactLabel(rule.id)} - ${scoreImpactForRule(rule.id).rationale}`],
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
