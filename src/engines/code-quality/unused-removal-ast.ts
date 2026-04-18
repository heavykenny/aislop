import ts from "typescript";
import type { UnusedDeclaration, UnusedKind } from "./unused-removal-types.js";

export interface PendingRemoval {
	start: number;
	end: number;
	declaration: UnusedDeclaration;
}

const getLineFromPos = (sourceFile: ts.SourceFile, pos: number): number =>
	sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

const nodeContainsLine = (
	sourceFile: ts.SourceFile,
	node: ts.Node,
	targetLine: number,
): boolean => {
	const startLine = getLineFromPos(sourceFile, node.getStart(sourceFile));
	const endLine = getLineFromPos(sourceFile, node.getEnd());
	return startLine <= targetLine && targetLine <= endLine;
};

const initializerHasSideEffects = (node: ts.Expression | undefined): boolean => {
	if (!node) return false;

	let unsafe = false;
	const visit = (n: ts.Node): void => {
		if (unsafe) return;

		if (
			ts.isCallExpression(n) ||
			ts.isNewExpression(n) ||
			ts.isTaggedTemplateExpression(n) ||
			ts.isAwaitExpression(n) ||
			ts.isYieldExpression(n) ||
			ts.isDeleteExpression(n) ||
			ts.isPostfixUnaryExpression(n)
		) {
			unsafe = true;
			return;
		}

		if (
			ts.isBinaryExpression(n) &&
			n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
			n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
		) {
			unsafe = true;
			return;
		}

		if (
			ts.isPrefixUnaryExpression(n) &&
			(n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)
		) {
			unsafe = true;
			return;
		}

		// Don't recurse into function/arrow bodies — the body only runs when called.
		if (
			ts.isArrowFunction(n) ||
			ts.isFunctionExpression(n) ||
			ts.isFunctionDeclaration(n) ||
			ts.isMethodDeclaration(n) ||
			ts.isGetAccessor(n) ||
			ts.isSetAccessor(n)
		) {
			return;
		}

		ts.forEachChild(n, visit);
	};

	visit(node);
	return unsafe;
};

const computeRemovalRange = (
	sourceFile: ts.SourceFile,
	node: ts.Node,
	content: string,
): { start: number; end: number } => {
	const nodeStart = node.getStart(sourceFile);
	const end = node.getEnd();

	// Start: walk back to the beginning of the line containing the node's real
	// (non-trivia) start.
	let start = nodeStart;
	while (start > 0 && content[start - 1] !== "\n") start--;

	const ranges = ts.getLeadingCommentRanges(content, node.getFullStart()) ?? [];
	if (ranges.length > 0) {
		// Keep any comment whose end is on the line directly above `start`
		// (i.e. no intervening blank line).
		let cursor = start;
		for (let i = ranges.length - 1; i >= 0; i--) {
			const r = ranges[i];
			// The comment must end at or just before cursor (only whitespace +
			// at most one newline between comment end and cursor).
			const between = content.slice(r.end, cursor);
			if (/^\s*$/.test(between) && (between.match(/\n/g) ?? []).length <= 1) {
				// Include this comment; move cursor to the comment's line start.
				let cs = r.pos;
				while (cs > 0 && content[cs - 1] !== "\n") cs--;
				cursor = cs;
			} else {
				break;
			}
		}
		start = cursor;
	}

	// Include the trailing newline after the node so we don't leave an empty line.
	let finalEnd = end;
	if (finalEnd < content.length && content[finalEnd] === "\r") finalEnd++;
	if (finalEnd < content.length && content[finalEnd] === "\n") finalEnd++;

	return { start, end: finalEnd };
};

const kindOfStatement = (node: ts.Statement): UnusedKind | null => {
	if (ts.isVariableStatement(node)) return "variable";
	if (ts.isFunctionDeclaration(node)) return "function";
	if (ts.isClassDeclaration(node)) return "class";
	if (ts.isTypeAliasDeclaration(node)) return "type";
	if (ts.isInterfaceDeclaration(node)) return "interface";
	if (ts.isEnumDeclaration(node)) return "enum";
	return null;
};

export interface MatchResult {
	type: "match";
	removal: PendingRemoval;
}

export interface SkipResult {
	type: "skip";
	reason: string;
	declaration: UnusedDeclaration;
}

export interface NoneResult {
	type: "none";
}

export const matchStatement = (
	sourceFile: ts.SourceFile,
	statement: ts.Statement,
	content: string,
	decl: UnusedDeclaration,
): MatchResult | SkipResult | NoneResult => {
	const kind = kindOfStatement(statement);
	if (!kind) return { type: "none" };

	// Match by name + location. We deliberately do NOT gate on `decl.kind`
	// matching `kind` — upstream sources conflate kinds (knip reports an
	// exported interface as "Unused type: …", for example). The name must
	// be unique within a top-level file anyway, so name + line is enough.

	if (ts.isVariableStatement(statement)) {
		const varDecls = statement.declarationList.declarations;
		if (varDecls.length === 0) return { type: "none" };

		const match = varDecls.find((vd) => {
			const nameNode = vd.name;
			if (!ts.isIdentifier(nameNode)) return false;
			if (nameNode.text !== decl.name) return false;
			return nodeContainsLine(sourceFile, vd, decl.line);
		});
		if (!match) return { type: "none" };

		if (varDecls.length > 1) {
			return {
				type: "skip",
				reason: "multi-declaration variable statement",
				declaration: decl,
			};
		}

		if (initializerHasSideEffects(match.initializer)) {
			return {
				type: "skip",
				reason: "initializer may have side effects",
				declaration: decl,
			};
		}

		const range = computeRemovalRange(sourceFile, statement, content);
		return { type: "match", removal: { ...range, declaration: decl } };
	}

	if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
		if (!statement.name) return { type: "none" };
		if (statement.name.text !== decl.name) return { type: "none" };
		if (!nodeContainsLine(sourceFile, statement, decl.line)) return { type: "none" };
		const range = computeRemovalRange(sourceFile, statement, content);
		return { type: "match", removal: { ...range, declaration: decl } };
	}

	if (
		ts.isTypeAliasDeclaration(statement) ||
		ts.isInterfaceDeclaration(statement) ||
		ts.isEnumDeclaration(statement)
	) {
		if (statement.name.text !== decl.name) return { type: "none" };
		if (!nodeContainsLine(sourceFile, statement, decl.line)) return { type: "none" };
		const range = computeRemovalRange(sourceFile, statement, content);
		return { type: "match", removal: { ...range, declaration: decl } };
	}

	return { type: "none" };
};

export const applyRemovals = (content: string, removals: PendingRemoval[]): string => {
	const ordered = [...removals].sort((a, b) => b.start - a.start);
	let output = content;
	for (const r of ordered) {
		output = output.slice(0, r.start) + output.slice(r.end);
	}
	return output;
};

interface SourceFileWithParseDiagnostics {
	parseDiagnostics?: ts.Diagnostic[];
}

export const hasSyntaxDiagnostics = (filePath: string, content: string): boolean => {
	const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true) as ts.SourceFile &
		SourceFileWithParseDiagnostics;
	// `parseDiagnostics` is internal but widely used for this purpose.
	const diagnostics = sf.parseDiagnostics;
	return Array.isArray(diagnostics) && diagnostics.length > 0;
};
