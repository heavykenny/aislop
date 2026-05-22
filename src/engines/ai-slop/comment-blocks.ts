import { MEANINGFUL_JSDOC_TAGS } from "./narrative-comments-patterns.js";

export type BlockKind = "line" | "jsdoc";

export interface CommentBlock {
	kind: BlockKind;
	startLine: number;
	endLine: number;
	rawLines: string[];
	prose: string[];
	hasMeaningfulJsdocTag: boolean;
	isRustDoc: boolean;
	nextNonBlankLine: string | null;
}

const stripJsdocLine = (line: string): string =>
	line
		.replace(/^\s*\/\*\*+\s?/, "")
		.replace(/\s*\*+\/\s*$/, "")
		.replace(/^\s*\*\s?/, "")
		.trim();

const stripLineComment = (line: string): string => line.replace(/^\s*(?:(?:\/\/)|#)\s?/, "");

export const getCommentSyntax = (ext: string): { linePrefixes: string[] } | null => {
	switch (ext) {
		case ".ts":
		case ".tsx":
		case ".js":
		case ".jsx":
		case ".mjs":
		case ".cjs":
		case ".go":
		case ".rs":
		case ".java":
			return { linePrefixes: ["//"] };
		case ".py":
		case ".rb":
			return { linePrefixes: ["#"] };
		case ".php":
			return { linePrefixes: ["//", "#"] };
		default:
			return null;
	}
};

const getMatchedLinePrefix = (line: string, syntax: { linePrefixes: string[] }): string | null => {
	const trimmed = line.trimStart();
	for (const prefix of syntax.linePrefixes) {
		if (!trimmed.startsWith(prefix)) continue;
		if (prefix === "#" && trimmed.startsWith("#!")) return null;
		return prefix;
	}
	return null;
};

const isRustDocCommentLine = (line: string): boolean => {
	const trimmed = line.trimStart();
	return trimmed.startsWith("///") || trimmed.startsWith("//!");
};

export const collectBlocks = (
	sourceLines: string[],
	syntax: { linePrefixes: string[] },
): CommentBlock[] => {
	const blocks: CommentBlock[] = [];
	let i = 0;
	while (i < sourceLines.length) {
		const line = sourceLines[i];
		const trimmed = line.trim();
		const matchedPrefix = getMatchedLinePrefix(line, syntax);

		if (matchedPrefix !== null) {
			const start = i;
			const raw: string[] = [];
			while (i < sourceLines.length && getMatchedLinePrefix(sourceLines[i], syntax) !== null) {
				raw.push(sourceLines[i]);
				i += 1;
			}
			let next = i;
			while (next < sourceLines.length && sourceLines[next].trim() === "") next += 1;
			const docCandidates = raw.filter((l) => l.trim().length > 0);
			const isRustDoc =
				docCandidates.length > 0 && docCandidates.every((l) => isRustDocCommentLine(l));
			blocks.push({
				kind: "line",
				startLine: start + 1,
				endLine: start + raw.length,
				rawLines: raw,
				prose: raw.map(stripLineComment),
				hasMeaningfulJsdocTag: false,
				isRustDoc,
				nextNonBlankLine: next < sourceLines.length ? sourceLines[next] : null,
			});
			continue;
		}

		if (trimmed.startsWith("/**")) {
			const start = i;
			const raw: string[] = [sourceLines[i]];
			let hasClose = /\*\/\s*$/.test(sourceLines[i]) && sourceLines[i].trim() !== "/**";
			i += 1;
			while (!hasClose && i < sourceLines.length) {
				raw.push(sourceLines[i]);
				if (/\*\/\s*$/.test(sourceLines[i])) {
					hasClose = true;
				}
				i += 1;
			}
			let next = i;
			while (next < sourceLines.length && sourceLines[next].trim() === "") next += 1;

			const prose = raw.map(stripJsdocLine).filter((l) => l.length > 0 && !l.startsWith("@"));
			const tagNames: string[] = [];
			for (const line of raw) {
				const stripped = stripJsdocLine(line);
				if (stripped.startsWith("@")) {
					const tagMatch = stripped.match(/^@(\w+)/);
					if (tagMatch) tagNames.push(tagMatch[1].toLowerCase());
				}
			}
			const hasMeaningful = tagNames.some((t) => MEANINGFUL_JSDOC_TAGS.has(t));
			blocks.push({
				kind: "jsdoc",
				startLine: start + 1,
				endLine: start + raw.length,
				rawLines: raw,
				prose,
				hasMeaningfulJsdocTag: hasMeaningful,
				isRustDoc: false,
				nextNonBlankLine: next < sourceLines.length ? sourceLines[next] : null,
			});
			continue;
		}

		i += 1;
	}
	return blocks;
};
