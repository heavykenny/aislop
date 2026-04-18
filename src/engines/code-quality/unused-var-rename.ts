import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
	classifyIdentifier,
	computeEdit,
	findCandidateIdentifiers,
	type PendingEdit,
} from "./unused-var-rename-ast.js";

export interface UnusedVarTarget {
	/** Absolute file path */
	filePath: string;
	/** 1-based line of the unused identifier */
	line: number;
	/** 1-based column of the unused identifier */
	column: number;
	/** Name of the unused identifier */
	name: string;
	/** From oxlint's rule kind */
	type: "variable" | "parameter";
}

interface RenameResult {
	renamed: number;
	skipped: Array<{ target: UnusedVarTarget; reason: string }>;
}

interface SourceFileWithParseDiagnostics extends ts.SourceFile {
	parseDiagnostics?: ts.Diagnostic[];
}

const hasSyntaxDiagnostics = (filePath: string, content: string): boolean => {
	const sf = ts.createSourceFile(
		filePath,
		content,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	) as SourceFileWithParseDiagnostics;
	const diagnostics = sf.parseDiagnostics;
	return Array.isArray(diagnostics) && diagnostics.length > 0;
};

const pickBestCandidate = (
	sourceFile: ts.SourceFile,
	candidates: ts.Identifier[],
	target: UnusedVarTarget,
): ts.Identifier | null => {
	let best: ts.Identifier | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const c of candidates) {
		const { line, character } = sourceFile.getLineAndCharacterOfPosition(c.getStart(sourceFile));
		const oneBasedCol = character + 1;
		const lineDist = Math.abs(line + 1 - target.line) * 1000;
		const colDist = Math.abs(oneBasedCol - target.column);
		const distance = lineDist + colDist;
		if (distance < bestDistance) {
			bestDistance = distance;
			best = c;
		}
	}
	return best;
};

const applyEditsDescending = (content: string, edits: PendingEdit[]): string => {
	const ordered = [...edits].sort((a, b) => b.start - a.start);
	let output = content;
	for (const e of ordered) {
		output = output.slice(0, e.start) + e.replacement + output.slice(e.end);
	}
	return output;
};

const processFile = (
	filePath: string,
	fileTargets: UnusedVarTarget[],
	result: RenameResult,
): void => {
	if (!fs.existsSync(filePath)) {
		for (const t of fileTargets) {
			result.skipped.push({ target: t, reason: "file not found" });
		}
		return;
	}

	const original = fs.readFileSync(filePath, "utf-8");
	const originalHadSyntaxErrors = hasSyntaxDiagnostics(filePath, original);

	const sourceFile = ts.createSourceFile(
		filePath,
		original,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);

	const edits: PendingEdit[] = [];
	const pendingSkips: Array<{ target: UnusedVarTarget; reason: string }> = [];
	const seenRanges = new Set<string>();

	for (const target of fileTargets) {
		const candidates = findCandidateIdentifiers(sourceFile, target.name, target.line);
		if (candidates.length === 0) {
			pendingSkips.push({ target, reason: "target node not found" });
			continue;
		}
		const best = pickBestCandidate(sourceFile, candidates, target);
		if (!best) {
			pendingSkips.push({ target, reason: "target node not found" });
			continue;
		}
		const shape = classifyIdentifier(best);
		const { edit, skipReason } = computeEdit(sourceFile, shape);
		if (!edit) {
			pendingSkips.push({ target, reason: skipReason ?? "unable to compute edit" });
			continue;
		}
		const rangeKey = `${edit.start}:${edit.end}`;
		if (seenRanges.has(rangeKey)) continue;
		seenRanges.add(rangeKey);
		edits.push(edit);
	}

	if (edits.length === 0) {
		for (const s of pendingSkips) result.skipped.push(s);
		return;
	}

	const updated = applyEditsDescending(original, edits);

	if (updated === original) {
		for (const s of pendingSkips) result.skipped.push(s);
		return;
	}

	if (!originalHadSyntaxErrors && hasSyntaxDiagnostics(filePath, updated)) {
		for (const t of fileTargets) {
			const wasEditTarget = !pendingSkips.some((p) => p.target === t);
			if (wasEditTarget) {
				result.skipped.push({ target: t, reason: "rename would break file syntax" });
			}
		}
		for (const s of pendingSkips) result.skipped.push(s);
		return;
	}

	fs.writeFileSync(filePath, updated);
	result.renamed += edits.length;
	for (const s of pendingSkips) result.skipped.push(s);
};

export const prefixUnusedVars = (
	rootDirectory: string,
	targets: UnusedVarTarget[],
): RenameResult => {
	const result: RenameResult = { renamed: 0, skipped: [] };

	const byFile = new Map<string, UnusedVarTarget[]>();
	for (const t of targets) {
		const absolute = path.isAbsolute(t.filePath)
			? t.filePath
			: path.join(rootDirectory, t.filePath);
		const arr = byFile.get(absolute) ?? [];
		arr.push({ ...t, filePath: absolute });
		byFile.set(absolute, arr);
	}

	for (const [filePath, fileTargets] of byFile) {
		processFile(filePath, fileTargets, result);
	}

	return result;
};
