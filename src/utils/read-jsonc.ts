import fs from "node:fs";

/** Strip block and line comments outside JSON strings (preserves `@/*` paths and `https://` URLs). */
const stripJsonComments = (raw: string): string => {
	let result = "";
	let i = 0;
	let inString: '"' | "'" | null = null;
	let escaped = false;

	while (i < raw.length) {
		const ch = raw[i];
		const next = raw[i + 1];

		if (inString) {
			result += ch;
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === inString) {
				inString = null;
			}
			i++;
			continue;
		}

		if (ch === '"' || ch === "'") {
			inString = ch;
			result += ch;
			i++;
			continue;
		}

		if (ch === "/" && next === "/") {
			i += 2;
			while (i < raw.length && raw[i] !== "\n") i++;
			continue;
		}

		if (ch === "/" && next === "*") {
			i += 2;
			while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
			i += 2;
			continue;
		}

		result += ch;
		i++;
	}

	return result;
};

export const parseJsonc = (raw: string): unknown => {
	try {
		return JSON.parse(raw);
	} catch {
		try {
			return JSON.parse(stripJsonComments(raw));
		} catch {
			return null;
		}
	}
};

export const readJsoncFile = (filePath: string): unknown => {
	try {
		return parseJsonc(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return null;
	}
};
