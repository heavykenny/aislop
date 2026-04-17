import { type Symbols } from "./symbols.js";
import { style, theme as defaultTheme, type Theme } from "./theme.js";

interface HeaderInput {
	version: string;
	command: string;
	context: string[];
	/** When false, skip the brand line and emit only the sub-header. */
	brand?: boolean;
}

interface HeaderDeps {
	theme?: Theme;
	symbols?: Symbols;
}

const TAGLINE = "the quality gate for agentic coding";

export const renderHeader = (input: HeaderInput, _deps: HeaderDeps = {}): string => {
	const t = _deps.theme ?? defaultTheme;
	const sep = style(t, "accent", "·");
	const brand = style(t, "accent", "aislop");
	const version = style(t, "accentDim", input.version);

	const showBrand = input.brand !== false;
	const brandLine = ` ${brand} ${version}  ${sep}  ${TAGLINE}`;

	if (input.command === "--bare") {
		return showBrand ? `${brandLine}\n\n` : "";
	}

	const contextParts = [input.command, ...input.context].filter((p) => p && p.length > 0);
	const subLine =
		contextParts.length > 0
			? ` ${contextParts
					.map((p, i) => (i === 0 ? style(t, "fg", p) : style(t, "muted", p)))
					.join(`  ${sep}  `)}`
			: "";

	if (!showBrand) {
		return subLine ? `${subLine}\n\n` : "";
	}
	return subLine ? `${brandLine}\n\n${subLine}\n\n` : `${brandLine}\n\n`;
};
