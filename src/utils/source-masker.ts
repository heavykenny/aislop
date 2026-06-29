type LangFamily = "js" | "py" | "rb" | "php" | "cstyle" | "none";

const JS_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const PY_EXTS = new Set([".py"]);
const RB_EXTS = new Set([".rb"]);
const PHP_EXTS = new Set([".php"]);
const C_STYLE_COMMENT_EXTS = new Set([".go"]);

const familyForExt = (ext: string): LangFamily => {
	if (JS_EXTS.has(ext)) return "js";
	if (PY_EXTS.has(ext)) return "py";
	if (RB_EXTS.has(ext)) return "rb";
	if (PHP_EXTS.has(ext)) return "php";
	if (C_STYLE_COMMENT_EXTS.has(ext)) return "cstyle";
	return "none";
};

export const maskStringsAndComments = (content: string, ext: string): string => {
	const family = familyForExt(ext);
	if (family === "none") return content;
	if (family === "js") return maskJs(content, true);
	if (family === "cstyle") return maskCStyle(content, true);
	return maskSimple(content, family, true);
};

// Mask comment bodies only; string and template contents stay readable.
export const maskComments = (content: string, ext: string): string => {
	const family = familyForExt(ext);
	if (family === "none") return content;
	if (family === "js") return maskJs(content, false);
	if (family === "cstyle") return maskCStyle(content, false);
	return maskSimple(content, family, false);
};

interface MaskHandler {
	handled: boolean;
	nextI: number;
}

const handleQuotesAndComments = (
	content: string,
	i: number,
	tplStack: number[],
	mask: (start: number, end: number) => void,
	maskStrings: boolean,
): MaskHandler => {
	const len = content.length;
	const c = content[i];
	const next = content[i + 1];
	if (c === '"' || c === "'") {
		const strStart = i;
		const end = consumeQuotedString(content, i, c);
		if (maskStrings) mask(strStart + 1, end - 1);
		return { handled: true, nextI: end };
	}
	if (c === "`") {
		const scan = consumeTemplateString(content, i + 1);
		if (maskStrings) mask(i + 1, scan.maskEnd);
		if (scan.openedInterp) tplStack.push(0);
		return { handled: true, nextI: scan.resumeAt };
	}
	if (c === "/" && next === "/") {
		const strStart = i;
		let k = i;
		while (k < len && content[k] !== "\n") k++;
		mask(strStart, k);
		return { handled: true, nextI: k };
	}
	if (c === "/" && next === "*") {
		const strStart = i;
		let k = i + 2;
		while (k < len - 1 && !(content[k] === "*" && content[k + 1] === "/")) k++;
		if (k < len - 1) k += 2;
		mask(strStart, k);
		return { handled: true, nextI: k };
	}
	return { handled: false, nextI: i };
};

const REGEX_PRECEDING_KEYWORDS = new Set([
	"return",
	"typeof",
	"instanceof",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"do",
	"else",
	"yield",
	"await",
	"case",
	"throw",
]);

const regexAllowedAt = (content: string, slashIndex: number): boolean => {
	let p = slashIndex - 1;
	while (
		p >= 0 &&
		(content[p] === " " || content[p] === "\t" || content[p] === "\n" || content[p] === "\r")
	) {
		p--;
	}
	if (p < 0) return true;
	const ch = content[p];
	if (ch === ")" || ch === "]" || ch === "}" || ch === '"' || ch === "'" || ch === "`") {
		return false;
	}
	if (/[A-Za-z0-9_$]/.test(ch)) {
		let w = p;
		while (w >= 0 && /[A-Za-z0-9_$]/.test(content[w])) w--;
		return REGEX_PRECEDING_KEYWORDS.has(content.slice(w + 1, p + 1));
	}
	return true;
};

const consumeRegex = (content: string, start: number): number => {
	const len = content.length;
	let i = start + 1;
	let inClass = false;
	while (i < len) {
		const c = content[i];
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (c === "\n") return -1;
		if (c === "[") inClass = true;
		else if (c === "]") inClass = false;
		else if (c === "/" && !inClass) {
			i++;
			while (i < len && /[a-z]/i.test(content[i])) i++;
			return i;
		}
		i++;
	}
	return -1;
};

const maskJs = (content: string, maskStrings: boolean): string => {
	const out = content.split("");
	const len = content.length;
	const tplStack: number[] = [];
	let i = 0;

	const mask = (start: number, end: number) => {
		for (let k = start; k < end; k++) {
			if (out[k] !== "\n") out[k] = " ";
		}
	};

	while (i < len) {
		const c = content[i];

		if (tplStack.length > 0) {
			if (c === "{") {
				tplStack[tplStack.length - 1]++;
				i++;
				continue;
			}
			if (c === "}") {
				const depth = tplStack[tplStack.length - 1];
				if (depth === 0) {
					tplStack.pop();
					const scan = consumeTemplateString(content, i + 1);
					if (maskStrings) mask(i + 1, scan.maskEnd);
					if (scan.openedInterp) tplStack.push(0);
					i = scan.resumeAt;
					continue;
				}
				tplStack[tplStack.length - 1]--;
				i++;
				continue;
			}
		}

		if (
			c === "/" &&
			content[i + 1] !== "/" &&
			content[i + 1] !== "*" &&
			regexAllowedAt(content, i)
		) {
			const regexEnd = consumeRegex(content, i);
			if (regexEnd !== -1) {
				i = regexEnd;
				continue;
			}
		}

		const handled = handleQuotesAndComments(content, i, tplStack, mask, maskStrings);
		if (handled.handled) {
			i = handled.nextI;
			continue;
		}

		i++;
	}

	return out.join("");
};

const maskCStyle = (content: string, maskStrings: boolean): string => {
	const out = content.split("");
	const len = content.length;
	let i = 0;

	const mask = (start: number, end: number) => {
		for (let k = start; k < end; k++) {
			if (out[k] !== "\n") out[k] = " ";
		}
	};

	while (i < len) {
		const c = content[i];
		const next = content[i + 1];

		if (c === '"' || c === "'") {
			const strStart = i;
			i = consumeQuotedString(content, i, c);
			if (maskStrings) mask(strStart + 1, i - 1);
			continue;
		}

		if (c === "`") {
			const strStart = i;
			const end = content.indexOf("`", i + 1);
			i = end === -1 ? len : end + 1;
			if (maskStrings) mask(strStart + 1, i - 1);
			continue;
		}

		if (c === "/" && next === "/") {
			const start = i;
			while (i < len && content[i] !== "\n") i++;
			mask(start, i);
			continue;
		}

		if (c === "/" && next === "*") {
			const start = i;
			i += 2;
			while (i < len - 1 && !(content[i] === "*" && content[i + 1] === "/")) i++;
			if (i < len - 1) i += 2;
			mask(start, i);
			continue;
		}

		i++;
	}

	return out.join("");
};

// Consume a quoted string starting at the opening quote. Returns the index
// just past the closing quote (or end-of-content if unterminated).
const consumeQuotedString = (content: string, start: number, quote: string): number => {
	const len = content.length;
	let i = start + 1;
	while (i < len) {
		const c = content[i];
		if (c === "\\" && i + 1 < len) {
			i += 2;
			continue;
		}
		if (c === quote) return i + 1;
		if (c === "\n") return i; // unterminated — bail
		i++;
	}
	return i;
};

interface TemplateScan {
	maskEnd: number;
	resumeAt: number;
	openedInterp: boolean;
}

const consumeTemplateString = (content: string, start: number): TemplateScan => {
	const len = content.length;
	let i = start;
	while (i < len) {
		const c = content[i];
		if (c === "\\" && i + 1 < len) {
			i += 2;
			continue;
		}
		if (c === "`") return { maskEnd: i, resumeAt: i + 1, openedInterp: false };
		if (c === "$" && content[i + 1] === "{") {
			return { maskEnd: i, resumeAt: i + 2, openedInterp: true };
		}
		i++;
	}
	return { maskEnd: i, resumeAt: i, openedInterp: false };
};

const maskSimple = (content: string, family: LangFamily, maskStrings: boolean): string => {
	const out = content.split("");
	const len = content.length;
	let i = 0;

	const mask = (start: number, end: number) => {
		for (let k = start; k < end; k++) {
			if (out[k] !== "\n") out[k] = " ";
		}
	};

	while (i < len) {
		const c = content[i];
		const next = content[i + 1];

		if (family === "py" && (c === '"' || c === "'")) {
			// Triple-quoted?
			if (content[i + 1] === c && content[i + 2] === c) {
				const triple = c + c + c;
				const end = content.indexOf(triple, i + 3);
				const stop = end === -1 ? len : end + 3;
				if (maskStrings) mask(i + 3, stop - 3);
				i = stop;
				continue;
			}
		}

		if (c === '"' || c === "'") {
			const strStart = i;
			i = consumeQuotedString(content, i, c);
			if (maskStrings) mask(strStart + 1, i - 1);
			continue;
		}

		if ((family === "py" || family === "rb" || family === "php") && c === "#") {
			const strStart = i;
			while (i < len && content[i] !== "\n") i++;
			mask(strStart, i);
			continue;
		}

		if (family === "php" && c === "/" && next === "/") {
			const strStart = i;
			while (i < len && content[i] !== "\n") i++;
			mask(strStart, i);
			continue;
		}

		if (family === "php" && c === "/" && next === "*") {
			const strStart = i;
			i += 2;
			while (i < len - 1 && !(content[i] === "*" && content[i + 1] === "/")) i++;
			if (i < len - 1) i += 2;
			mask(strStart, i);
			continue;
		}

		i++;
	}

	return out.join("");
};
