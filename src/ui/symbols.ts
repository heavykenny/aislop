export interface Symbols {
	stepActive: string;
	stepDone: string;
	rail: string;
	railEnd: string;
	bullet: string;
	hint: string;
	pass: string;
	fail: string;
	warn: string;
	pending: string;
	engineActive: string;
	neutral: string;
}

const TTY: Symbols = {
	stepActive: "◇",
	stepDone: "◆",
	rail: "│",
	railEnd: "└",
	bullet: "●",
	hint: "→",
	pass: "✓",
	fail: "✗",
	warn: "!",
	pending: "•",
	engineActive: "⏵",
	neutral: "─",
};

const PLAIN: Symbols = {
	stepActive: "*",
	stepDone: "*",
	rail: "|",
	railEnd: "+",
	bullet: "-",
	hint: "->",
	pass: "[ok]",
	fail: "[x]",
	warn: "[!]",
	pending: "-",
	engineActive: ">",
	neutral: "-",
};

export const createSymbols = (opts: { plain?: boolean } = {}): Symbols =>
	opts.plain ? PLAIN : TTY;

const isPlain = (): boolean =>
	process.env.THEME === "plain" || Boolean(process.env.NO_COLOR) || !process.stdout.isTTY;

export const symbols: Symbols = createSymbols({ plain: isPlain() });
