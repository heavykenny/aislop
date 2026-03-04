import fs from "node:fs";
import path from "node:path";
import { getSourceFiles } from "../../utils/source-files.js";
import type { Diagnostic, EngineContext } from "../types.js";

const MIN_DUPLICATE_LINES = 12;
const MIN_DUPLICATE_CHARS = 240;
const MAX_DUPLICATE_REPORTS = 50;

interface DuplicateOccurrence {
	filePath: string;
	startLine: number;
}

const isIgnorableLine = (line: string): boolean => {
	const trimmed = line.trim();
	return (
		trimmed.length === 0 ||
		trimmed.startsWith("//") ||
		trimmed.startsWith("/*") ||
		trimmed.startsWith("*") ||
		trimmed.startsWith("#")
	);
};

const normalizeLine = (line: string): string =>
	line.trim().replace(/\s+/g, " ");

const extractDuplicateBlocks = (
	content: string,
): Array<{ key: string; startLine: number }> => {
	const blocks: Array<{ key: string; startLine: number }> = [];
	const lines = content.split("\n");

	for (let i = 0; i <= lines.length - MIN_DUPLICATE_LINES; i++) {
		const segment = lines.slice(i, i + MIN_DUPLICATE_LINES);
		if (segment.some(isIgnorableLine)) continue;

		const normalized = segment.map(normalizeLine);
		const key = normalized.join("\n");
		if (key.length < MIN_DUPLICATE_CHARS) continue;

		blocks.push({ key, startLine: i + 1 });
	}

	return blocks;
};

export const checkDuplication = async (
	context: EngineContext,
): Promise<Diagnostic[]> => {
	const files = getSourceFiles(context);
	const duplicates = new Map<string, DuplicateOccurrence[]>();

	for (const absoluteFilePath of files) {
		let content = "";
		try {
			content = fs.readFileSync(absoluteFilePath, "utf-8");
		} catch {
			continue;
		}

		const relativeFilePath = path.relative(
			context.rootDirectory,
			absoluteFilePath,
		);
		for (const block of extractDuplicateBlocks(content)) {
			const occurrence = {
				filePath: relativeFilePath,
				startLine: block.startLine,
			};
			const list = duplicates.get(block.key) ?? [];
			list.push(occurrence);
			duplicates.set(block.key, list);
		}
	}

	const diagnostics: Diagnostic[] = [];
	const reportedPairs = new Set<string>();
	for (const occurrences of duplicates.values()) {
		if (occurrences.length < 2) continue;
		const source = occurrences[0];

		for (const occurrence of occurrences.slice(1)) {
			if (diagnostics.length >= MAX_DUPLICATE_REPORTS) return diagnostics;
			if (
				occurrence.filePath === source.filePath &&
				occurrence.startLine === source.startLine
			)
				continue;
			if (occurrence.filePath === source.filePath) continue;

			const pairKey = `${source.filePath}->${occurrence.filePath}`;
			if (reportedPairs.has(pairKey)) continue;
			reportedPairs.add(pairKey);

			diagnostics.push({
				filePath: occurrence.filePath,
				engine: "code-quality",
				rule: "duplication/block",
				severity: "warning",
				message: `Possible duplicated code block (${MIN_DUPLICATE_LINES}+ lines) also found at ${source.filePath}:${source.startLine}`,
				help: "Extract shared logic into a reusable function or module",
				line: occurrence.startLine,
				column: 0,
				category: "Duplication",
				fixable: false,
			});
		}
	}

	return diagnostics;
};
