import { symbols as defaultSymbols, type Symbols } from "./symbols.js";
import { style, theme as defaultTheme, type Theme, type Token } from "./theme.js";

interface LoggerDeps {
	theme?: Theme;
	symbols?: Symbols;
	write?: (s: string) => void;
}

interface HintLineDeps {
	theme?: Theme;
	symbols?: Symbols;
}

/**
 * Render a single accent-green `→` hint line, consistent across every command.
 * Callers typically do: `process.stdout.write(renderHintLine("Run ..."))`.
 */
export const renderHintLine = (hint: string, deps: HintLineDeps = {}): string => {
	const t = deps.theme ?? defaultTheme;
	const s = deps.symbols ?? defaultSymbols;
	return ` ${style(t, "accent", s.hint)} ${hint}\n`;
};

interface Logger {
	success: (msg: string) => void;
	error: (msg: string) => void;
	warn: (msg: string) => void;
	info: (msg: string) => void;
	hint: (msg: string) => void;
	muted: (msg: string) => void;
	step: (msg: string) => void;
	break: () => void;
	raw: (msg: string) => void;
}

export const createLogger = (deps: LoggerDeps = {}): Logger => {
	const t = deps.theme ?? defaultTheme;
	const s = deps.symbols ?? defaultSymbols;
	const write = deps.write ?? ((out: string) => process.stdout.write(out));

	const line = (glyph: string, token: Token, msg: string) => {
		write(` ${style(t, token, glyph)} ${msg}\n`);
	};

	return {
		success: (msg) => line(s.pass, "success", msg),
		error: (msg) => line(s.fail, "danger", msg),
		warn: (msg) => line(s.warn, "warn", msg),
		info: (msg) => line(s.bullet, "info", msg),
		hint: (msg) => line(s.hint, "accent", msg),
		muted: (msg) => write(` ${style(t, "muted", msg)}\n`),
		step: (msg) => line(s.stepActive, "accent", msg),
		break: () => write("\n"),
		raw: (msg) => write(`${msg}\n`),
	};
};

export const log: Logger = createLogger();
