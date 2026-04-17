import wcwidth from "wcwidth";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");

const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");

export const stringWidth = (s: string): number => {
	const bare = stripAnsi(s);
	let total = 0;
	for (const ch of bare) {
		const cp = ch.codePointAt(0) ?? 0;
		const w = wcwidth(cp);
		total += w > 0 ? w : 1;
	}
	return total;
};

export const padEnd = (s: string, target: number, fill = " "): string => {
	const w = stringWidth(s);
	if (w >= target) return s;
	return s + fill.repeat(target - w);
};

export const padStart = (s: string, target: number, fill = " "): string => {
	const w = stringWidth(s);
	if (w >= target) return s;
	return fill.repeat(target - w) + s;
};

export const truncate = (s: string, max: number, ellipsis = "…"): string => {
	if (stringWidth(s) <= max) return s;
	const limit = Math.max(0, max - stringWidth(ellipsis));
	let out = "";
	let w = 0;
	for (const ch of s) {
		const cp = ch.codePointAt(0) ?? 0;
		const cw = wcwidth(cp);
		if (w + cw > limit) break;
		out += ch;
		w += cw;
	}
	return out + ellipsis;
};
