import { symbols as defaultSymbols, type Symbols } from "./symbols.js";
import { style, theme as defaultTheme, type Theme } from "./theme.js";

interface ErrorInput {
	message: string;
	cause?: string;
	hints?: string[];
	docsUrl?: string;
}

interface ErrorDeps {
	theme?: Theme;
	symbols?: Symbols;
}

export const renderError = (input: ErrorInput, deps: ErrorDeps = {}): string => {
	const t = deps.theme ?? defaultTheme;
	const s = deps.symbols ?? defaultSymbols;
	const lines = [`\n ${style(t, "danger", s.fail)} ${style(t, "danger", input.message)}`];

	if (input.cause) {
		lines.push(` ${style(t, "muted", s.rail)} ${style(t, "muted", input.cause)}`);
	}
	if ((input.hints && input.hints.length > 0) || input.docsUrl) {
		lines.push("");
	}
	for (const hint of input.hints ?? []) {
		lines.push(` ${style(t, "accent", s.hint)} ${hint}`);
	}
	if (input.docsUrl) {
		lines.push(` ${style(t, "accent", s.hint)} Docs: ${input.docsUrl}`);
	}
	lines.push("");
	return lines.join("\n");
};
