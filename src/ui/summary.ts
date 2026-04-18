import { symbols as defaultSymbols, type Symbols } from "./symbols.js";
import { style, theme as defaultTheme, type Theme, type Token } from "./theme.js";
import { padEnd } from "./width.js";

export interface NextStep {
	emphasis: "primary" | "muted";
	text: string;
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
