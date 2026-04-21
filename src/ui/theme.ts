// aislop-ignore-file duplicate-block
import pc from "picocolors";

export type ColorMode = "truecolor" | "256" | "none" | "auto";

interface ThemeOptions {
	color?: ColorMode;
	tty?: boolean;
	env?: NodeJS.ProcessEnv;
}

export type Token =
	| "accent"
	| "accentDim"
	| "fg"
	| "muted"
	| "danger"
	| "warn"
	| "info"
	| "success"
	| "bold"
	| "dim";

export interface Theme {
	mode: Exclude<ColorMode, "auto">;
	paint: Record<Token, (s: string) => string>;
}

const TRUECOLOR: Record<Token, (s: string) => string> = {
	accent: (s) => `\x1B[38;2;34;197;94m${s}\x1B[39m`,
	accentDim: (s) => `\x1B[38;2;22;163;74m${s}\x1B[39m`,
	fg: (s) => s,
	muted: (s) => `\x1B[38;2;113;113;122m${s}\x1B[39m`,
	danger: (s) => `\x1B[38;2;239;68;68m${s}\x1B[39m`,
	warn: (s) => `\x1B[38;2;234;179;8m${s}\x1B[39m`,
	info: (s) => `\x1B[38;2;56;189;248m${s}\x1B[39m`,
	success: (s) => `\x1B[38;2;34;197;94m${s}\x1B[39m`,
	bold: pc.bold,
	dim: pc.dim,
};

const C256: Record<Token, (s: string) => string> = {
	accent: (s) => `\x1B[38;5;10m${s}\x1B[39m`,
	accentDim: (s) => `\x1B[38;5;22m${s}\x1B[39m`,
	fg: (s) => s,
	muted: (s) => `\x1B[38;5;244m${s}\x1B[39m`,
	danger: (s) => `\x1B[38;5;9m${s}\x1B[39m`,
	warn: (s) => `\x1B[38;5;11m${s}\x1B[39m`,
	info: (s) => `\x1B[38;5;14m${s}\x1B[39m`,
	success: (s) => `\x1B[38;5;10m${s}\x1B[39m`,
	bold: pc.bold,
	dim: pc.dim,
};

const identity = (s: string) => s;
const NONE: Record<Token, (s: string) => string> = {
	accent: identity,
	accentDim: identity,
	fg: identity,
	muted: identity,
	danger: identity,
	warn: identity,
	info: identity,
	success: identity,
	bold: identity,
	dim: identity,
};

const detectMode = (tty: boolean, env: NodeJS.ProcessEnv): Exclude<ColorMode, "auto"> => {
	if (env.NO_COLOR) return "none";
	if (env.FORCE_COLOR === "0") return "none";
	if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") {
		return env.FORCE_COLOR === "3" ? "truecolor" : "256";
	}
	if (!tty) return "none";
	if (env.COLORTERM === "truecolor" || env.COLORTERM === "24bit") return "truecolor";
	return "256";
};

export const createTheme = (opts: ThemeOptions = {}): Theme => {
	const env = opts.env ?? process.env;
	const tty = opts.tty ?? Boolean(process.stdout.isTTY);
	const requested = opts.color ?? "auto";
	const mode = requested === "auto" ? detectMode(tty, env) : requested;
	const paint = mode === "truecolor" ? TRUECOLOR : mode === "256" ? C256 : NONE;
	return { mode, paint };
};

export const style = (theme: Theme, token: Token, text: string): string => theme.paint[token](text);

export const theme: Theme = createTheme();
