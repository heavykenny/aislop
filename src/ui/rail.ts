import { symbols as defaultSymbols, type Symbols } from "./symbols.js";
import { style, theme as defaultTheme, type Theme, type Token } from "./theme.js";

export type RailStepStatus = "active" | "done" | "warn" | "failed" | "skipped";

export interface RailStep {
	status: RailStepStatus;
	label: string;
	notes?: string[];
}

interface RailInput {
	steps: RailStep[];
	footer?: string;
}

interface RailDeps {
	theme?: Theme;
	symbols?: Symbols;
}

const glyphFor = (status: RailStepStatus, s: Symbols): { glyph: string; token: Token } => {
	switch (status) {
		case "done":
			return { glyph: s.stepDone, token: "accent" };
		case "active":
			return { glyph: s.stepActive, token: "accent" };
		case "warn":
			return { glyph: s.warn, token: "warn" };
		case "failed":
			return { glyph: s.fail, token: "danger" };
		case "skipped":
			return { glyph: s.neutral, token: "muted" };
	}
};

/**
 * Render a single rail step line (the glyph + label). Notes, if any, are
 * rendered on subsequent lines prefixed with the rail connector + hint glyph.
 * Does NOT include the trailing rail connector line between steps — use
 * renderRailConnector for that.
 */
export const renderRailStep = (step: RailStep, deps: RailDeps = {}): string => {
	const t = deps.theme ?? defaultTheme;
	const s = deps.symbols ?? defaultSymbols;
	const rail = style(t, "accentDim", s.rail);
	const { glyph, token } = glyphFor(step.status, s);
	const lines: string[] = [` ${style(t, token, glyph)} ${step.label}`];
	for (const note of step.notes ?? []) {
		lines.push(` ${rail} ${style(t, "accent", s.hint)} ${note}`);
	}
	return `${lines.join("\n")}\n`;
};

/**
 * Render a single vertical rail connector line — used between steps and
 * between the last step and the footer.
 */
export const renderRailConnector = (deps: RailDeps = {}): string => {
	const t = deps.theme ?? defaultTheme;
	const s = deps.symbols ?? defaultSymbols;
	return ` ${style(t, "accentDim", s.rail)}\n`;
};

/**
 * Render the rail-end footer line ("└  <footer text>").
 */
export const renderRailFooter = (footer: string, deps: RailDeps = {}): string => {
	const t = deps.theme ?? defaultTheme;
	const s = deps.symbols ?? defaultSymbols;
	return ` ${style(t, "accentDim", s.railEnd)}  ${footer}\n`;
};

export const renderRail = (input: RailInput, deps: RailDeps = {}): string => {
	const t = deps.theme ?? defaultTheme;
	const s = deps.symbols ?? defaultSymbols;
	const rail = style(t, "accentDim", s.rail);
	const railEnd = style(t, "accentDim", s.railEnd);
	const lines: string[] = [];

	input.steps.forEach((step, i) => {
		const { glyph, token } = glyphFor(step.status, s);
		lines.push(` ${style(t, token, glyph)} ${step.label}`);
		for (const note of step.notes ?? []) {
			lines.push(` ${rail} ${style(t, "accent", s.hint)} ${note}`);
		}
		if (i < input.steps.length - 1) lines.push(` ${rail}`);
	});

	if (input.footer !== undefined) {
		if (input.steps.length > 0) {
			lines.push(` ${rail}`);
		}
		lines.push(` ${railEnd}  ${input.footer}`);
	}

	return `\n${lines.join("\n")}\n`;
};
