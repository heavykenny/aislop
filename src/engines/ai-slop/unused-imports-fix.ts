import fs from "node:fs";
import { getSourceFiles } from "../../utils/source-files.js";
import type { EngineContext } from "../types.js";
import {
	type ImportedSymbol,
	JS_EXTENSIONS,
	PY_EXTENSIONS,
	REMOVE_MARKER,
	analyzeFile,
	getUnusedSymbols,
} from "./unused-imports.js";

export const fixUnusedImports = async (
	context: EngineContext,
): Promise<void> => {
	const files = getSourceFiles(context);

	for (const filePath of files) {
		const analysis = analyzeFile(filePath);
		if (!analysis) continue;

		const unused = getUnusedSymbols(
			analysis.lines,
			analysis.symbols,
			analysis.importLines,
		);

		if (unused.length === 0) continue;

		const unusedNames = new Set(unused.map((u) => u.name));
		const lines = [...analysis.lines];

		const symbolsByLine = new Map<number, ImportedSymbol[]>();
		for (const sym of analysis.symbols) {
			const arr = symbolsByLine.get(sym.line) ?? [];
			arr.push(sym);
			symbolsByLine.set(sym.line, arr);
		}

		const linesToRemove = new Set<number>();

		for (const [lineNo, syms] of symbolsByLine) {
			const lineIdx = lineNo - 1;
			const allUnused = syms.every((s) => unusedNames.has(s.name));

			const importSpan = getImportSpan(lineIdx, analysis.importLines);

			if (allUnused) {
				for (const idx of importSpan) {
					linesToRemove.add(idx);
				}
			} else if (JS_EXTENSIONS.has(analysis.ext)) {
				rewriteJsImportSpan(lines, importSpan, syms, unusedNames);
			} else if (PY_EXTENSIONS.has(analysis.ext)) {
				rewritePyImportLine(lines, lineIdx, syms, unusedNames);
			}
		}

		if (linesToRemove.size === 0 && unused.length === 0) continue;

		const sortedRemove = [...linesToRemove].sort((a, b) => b - a);
		for (const idx of sortedRemove) {
			lines.splice(idx, 1);
		}

		const filtered = lines.filter((l) => l !== REMOVE_MARKER);

		while (filtered.length > 0 && filtered[0].trim() === "") {
			filtered.shift();
		}

		fs.writeFileSync(filePath, filtered.join("\n"));
	}
};

const getImportSpan = (
	startIdx: number,
	importLines: Set<number>,
): number[] => {
	const span = [startIdx];
	let idx = startIdx + 1;
	while (importLines.has(idx)) {
		span.push(idx);
		idx++;
	}
	return span;
};

const rewriteJsImportSpan = (
	lines: string[],
	span: number[],
	syms: ImportedSymbol[],
	unusedNames: Set<string>,
): void => {
	const fullImport = span.map((i) => lines[i]).join("\n");

	const namedMatch = fullImport.match(/\{([^}]+)\}/s);
	if (!namedMatch) return;

	const unusedNamed = syms.filter(
		(s) => !s.isDefault && !s.isNamespace && unusedNames.has(s.name),
	);
	if (unusedNamed.length === 0) return;

	const unusedNamedSet = new Set(unusedNamed.map((s) => s.name));
	const originalSpecifiers = namedMatch[1]
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const keptSpecifiers = originalSpecifiers.filter((spec) => {
		const parts = spec.split(/\s+as\s+/);
		const localName =
			parts.length > 1
				? parts[1].trim().replace(/^type\s+/, "")
				: parts[0].trim().replace(/^type\s+/, "");
		return !unusedNamedSet.has(localName);
	});

	if (keptSpecifiers.length === 0) {
		const defaultSym = syms.find(
			(s) => s.isDefault && !unusedNames.has(s.name),
		);
		if (defaultSym) {
			const rewritten = fullImport
				.replace(/,\s*\{[^}]*\}/s, "")
				.replace(/\{[^}]*\}\s*,?\s*/s, "");
			lines[span[0]] = rewritten.replace(/\n/g, " ").replace(/\s+/g, " ");
			for (let i = 1; i < span.length; i++) {
				lines[span[i]] = REMOVE_MARKER;
			}
		}
		return;
	}

	const fromMatch = fullImport.match(/\}\s*(from\s+.+)$/s);
	const fromClause = fromMatch ? fromMatch[1].trim() : "";

	const importPrefix = fullImport.match(/^(import\s+(?:\w+\s*,\s*)?)/);
	const prefix = importPrefix ? importPrefix[1] : "import ";

	const wasMultiLine = span.length > 1;
	let newImport: string;

	if (wasMultiLine && keptSpecifiers.length > 2) {
		const indentMatch = lines[span[1]]?.match(/^(\s+)/);
		const indent = indentMatch ? indentMatch[1] : "\t";
		const specLines = keptSpecifiers
			.map((s) => `${indent}${s},`)
			.join("\n");
		newImport = `${prefix}{\n${specLines}\n} ${fromClause}`;
	} else {
		newImport = `${prefix}{ ${keptSpecifiers.join(", ")} } ${fromClause}`;
	}

	lines[span[0]] = newImport;
	for (let i = 1; i < span.length; i++) {
		lines[span[i]] = REMOVE_MARKER;
	}
};

const rewritePyImportLine = (
	lines: string[],
	lineIdx: number,
	syms: ImportedSymbol[],
	unusedNames: Set<string>,
): void => {
	const line = lines[lineIdx];
	const fromMatch = line.match(/^(\s*from\s+[\w.]+\s+import\s+)(.+)$/);
	if (!fromMatch) return;

	const prefix = fromMatch[1];
	const importPart = fromMatch[2].replace(/#.*$/, "").trim();
	const hasParen = importPart.startsWith("(");
	const cleaned = importPart.replace(/[()]/g, "");

	const specifiers = cleaned.split(",").map((s) => s.trim());
	const keptSpecifiers = specifiers.filter((spec) => {
		const parts = spec.split(/\s+as\s+/);
		const localName = parts.length > 1 ? parts[1].trim() : parts[0].trim();
		return !unusedNames.has(localName);
	});

	if (keptSpecifiers.length === 0) return;

	const joined = keptSpecifiers.join(", ");
	lines[lineIdx] = hasParen ? `${prefix}(${joined})` : `${prefix}${joined}`;
};
