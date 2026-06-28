import fs from "node:fs";

/** Strip block and line comments so tsconfig/jsconfig JSONC parses like tsc reads it. */
export const stripJsonComments = (raw: string): string =>
	raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

export const parseJsonc = (raw: string): unknown => {
	try {
		return JSON.parse(stripJsonComments(raw));
	} catch {
		return null;
	}
};

export const readJsoncFile = (filePath: string): unknown => {
	try {
		return parseJsonc(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return null;
	}
};