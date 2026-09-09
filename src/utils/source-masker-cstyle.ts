import { consumeQuotedString, cppRawStringAt, csharpStringAt } from "./string-literals.js";

export const maskCSharp = (content: string, maskStrings: boolean): string => {
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

		// A quote can open a plain, verbatim or raw literal, and the `$`/`@`
		// prefixes decide which, so let the C# scanner classify the delimiter.
		if (c === '"' || c === "$" || c === "@") {
			const span = csharpStringAt(content, i);
			if (span) {
				if (maskStrings) mask(span.bodyStart, span.bodyEnd);
				for (const range of span.interpolationRanges) {
					const expression = maskCSharp(content.slice(range.start, range.end), maskStrings);
					for (let offset = 0; offset < expression.length; offset++) {
						out[range.start + offset] = expression[offset];
					}
				}
				i = span.resumeAt;
				continue;
			}
		}

		if (c === "'") {
			const start = i;
			i = consumeQuotedString(content, i, "'");
			if (maskStrings) mask(start + 1, i - 1);
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

export const maskCStyle = (content: string, maskStrings: boolean): string => {
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
		const rawString = cppRawStringAt(content, i);
		if (rawString) {
			if (maskStrings) mask(rawString.bodyStart, rawString.bodyEnd);
			i = rawString.resumeAt;
			continue;
		}

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
