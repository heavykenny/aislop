import type { FindingAssessmentSummary } from "../output/finding-assessment.js";
import { labelForRule } from "../output/rule-labels.js";
import { symbols as defaultSymbols, type Symbols } from "./symbols.js";
import { theme as defaultTheme, style, type Theme, type Token } from "./theme.js";
import { padEnd } from "./width.js";

export interface NextStep {
	emphasis: "primary" | "muted";
	text: string;
}

export interface BreakdownRow {
	rule: string;
	errors: number;
	warnings: number;
	info: number;
	fixable: number;
}

export interface BreakdownSummary {
	rows: BreakdownRow[];
	hiddenRules: number;
	hiddenErrors: number;
	hiddenWarnings: number;
}

interface SummaryInput {
	score: number;
	label: string;
	errors: number;
	warnings: number;
	fixable: number;
	files: number;
	engines: number;
	elapsedMs: number;
	nextSteps: NextStep[];
	breakdown?: BreakdownSummary;
	findingAssessment?: FindingAssessmentSummary;
	thresholds?: { good: number; ok: number };
}

interface SummaryDeps {
	theme?: Theme;
	symbols?: Symbols;
}

const elapsed = (ms: number): string =>
	ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

const scoreToken = (score: number, thresholds: { good: number; ok: number }): Token => {
	if (score >= thresholds.good) return "success";
	if (score >= thresholds.ok) return "warn";
	return "danger";
};

const renderFindingAssessment = (
	assessment: FindingAssessmentSummary,
	t: Theme,
	sep: string,
): string[] => {
	if (assessment.rows.length === 0) return [];
	const parts = assessment.rows
		.filter((row) => row.count > 0)
		.map((row) => `${row.count} ${row.label}`);
	if (parts.length === 0) return [];
	const high = assessment.byConfidence.high;
	const medium = assessment.byConfidence.medium;
	const confidenceParts: string[] = [];
	if (high > 0) confidenceParts.push(`${high} high-confidence`);
	if (medium > 0) confidenceParts.push(`${medium} medium-confidence`);
	const confidence =
		confidenceParts.length > 0 ? `  ${sep}  ${style(t, "muted", confidenceParts.join(", "))}` : "";
	return [`   ${style(t, "muted", "Verdict mix:")} ${parts.join(`  ${sep}  `)}${confidence}`];
};

export const renderSummary = (input: SummaryInput, deps: SummaryDeps = {}): string => {
	const t = deps.theme ?? defaultTheme;
	const s = deps.symbols ?? defaultSymbols;
	const thresholds = input.thresholds ?? { good: 85, ok: 65 };
	const tok = scoreToken(input.score, thresholds);
	const sep = style(t, "accent", "·");

	const scoreText = padEnd(`${input.score} / 100`, 10);
	const labelText = padEnd(input.label, 12);
	const errorsText = style(t, "danger", `${input.errors} error${input.errors === 1 ? "" : "s"}`);
	const warningsText = style(
		t,
		"warn",
		`${input.warnings} warning${input.warnings === 1 ? "" : "s"}`,
	);
	const fixableText = style(t, "success", `${input.fixable} fixable`);
	const counters = `${errorsText}  ${sep}  ${warningsText}  ${sep}  ${fixableText}`;

	const scoreLine = `   ${style(t, tok, scoreText)}${style(t, tok, labelText)}  ${counters}`;
	const statsLine = `   ${style(t, "muted", `${input.files} files`)}  ${sep}  ${style(t, "muted", `${input.engines} engines`)}  ${sep}  ${style(t, "muted", elapsed(input.elapsedMs))}`;

	const lines = ["", scoreLine, statsLine, ""];

	if (input.findingAssessment) {
		lines.push(...renderFindingAssessment(input.findingAssessment, t, sep));
		lines.push("");
	}

	if (input.breakdown && input.breakdown.rows.length > 0) {
		lines.push(` ${style(t, "bold", "Top findings")}`);
		const maxCountWidth = input.breakdown.rows.reduce(
			(w, r) => Math.max(w, String(r.errors + r.warnings + r.info).length),
			0,
		);
		const labels = input.breakdown.rows.map((r) => labelForRule(r.rule));
		const maxLabelWidth = labels.reduce((w, l) => Math.max(w, l.length), 0);
		for (let i = 0; i < input.breakdown.rows.length; i++) {
			const row = input.breakdown.rows[i];
			const total = row.errors + row.warnings + row.info;
			const count = String(total).padStart(maxCountWidth);
			const label = padEnd(labels[i], maxLabelWidth);
			const tags: string[] = [];
			if (row.errors > 0) tags.push(style(t, "danger", `${row.errors} err`));
			if (row.warnings > 0) tags.push(style(t, "warn", `${row.warnings} warn`));
			if (row.info > 0) tags.push(style(t, "muted", `${row.info} info`));
			if (row.fixable > 0) tags.push(style(t, "success", `${row.fixable} fix`));
			const tagBlock = tags.length > 0 ? `  ${style(t, "muted", "·")}  ${tags.join("  ")}` : "";
			const ruleHint = style(t, "muted", `(${row.rule})`);
			lines.push(`   ${style(t, "muted", count)}  ${label}  ${ruleHint}${tagBlock}`);
		}
		if (input.breakdown.hiddenRules > 0) {
			const hiddenParts: string[] = [];
			if (input.breakdown.hiddenErrors > 0)
				hiddenParts.push(
					`${input.breakdown.hiddenErrors} error${input.breakdown.hiddenErrors === 1 ? "" : "s"}`,
				);
			if (input.breakdown.hiddenWarnings > 0)
				hiddenParts.push(
					`${input.breakdown.hiddenWarnings} warning${input.breakdown.hiddenWarnings === 1 ? "" : "s"}`,
				);
			const detail = hiddenParts.length > 0 ? ` (${hiddenParts.join(", ")})` : "";
			lines.push(
				style(
					t,
					"muted",
					`   +${input.breakdown.hiddenRules} more rule${input.breakdown.hiddenRules === 1 ? "" : "s"}${detail}. Run with -v for the full list.`,
				),
			);
		}
		lines.push("");
	}

	if (input.nextSteps.length > 0) {
		for (const step of input.nextSteps) {
			const glyph = step.emphasis === "primary" ? s.hint : s.bullet;
			const tokenFor: Token = step.emphasis === "primary" ? "accent" : "muted";
			lines.push(` ${style(t, tokenFor, glyph)} ${step.text}`);
		}
		lines.push("");
	}

	return lines.join("\n");
};

export const renderStarCta = (deps: SummaryDeps = {}): string => {
	const t = deps.theme ?? defaultTheme;
	return `\n ${style(t, "muted", "★ Found this useful? Star us at github.com/scanaislop/aislop")}\n`;
};

export const renderCleanRun = (
	input: { score?: number; label?: string; elapsedMs: number },
	deps: SummaryDeps = {},
): string => {
	const t = deps.theme ?? defaultTheme;
	const s = deps.symbols ?? defaultSymbols;
	const sep = style(t, "accent", "·");
	const parts = [style(t, "success", `${s.pass} Clean run`)];
	if (input.score !== undefined) {
		parts.push(style(t, "success", `${input.score} / 100`));
	}
	if (input.label) {
		parts.push(style(t, "success", input.label));
	}
	parts.push(style(t, "muted", "no issues"));
	parts.push(style(t, "muted", elapsed(input.elapsedMs)));
	return `\n ${parts.join(`  ${sep}  `)}\n`;
};
