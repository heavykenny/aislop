import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
	applyRemovals,
	hasSyntaxDiagnostics,
	matchStatement,
	type MatchResult,
	type NoneResult,
	type PendingRemoval,
	type SkipResult,
} from "./unused-removal-ast.js";
import type { RemovalResult, UnusedDeclaration } from "./unused-removal-types.js";

// Re-export the public type so external callers only need a single import path.
export type { UnusedDeclaration };
export { detectUnusedDeclarations, diagnosticsToDeclarations } from "./unused-removal-detect.js";

export const removeUnusedDeclarations = (
	rootDirectory: string,
	declarations: UnusedDeclaration[],
): RemovalResult => {
	const result: RemovalResult = { removed: 0, skipped: [] };

	// Group by resolved absolute filePath.
	const byFile = new Map<string, UnusedDeclaration[]>();
	for (const decl of declarations) {
		const absolute = path.isAbsolute(decl.filePath)
			? decl.filePath
			: path.join(rootDirectory, decl.filePath);
		const arr = byFile.get(absolute) ?? [];
		arr.push(decl);
		byFile.set(absolute, arr);
	}

	for (const [filePath, fileDecls] of byFile) {
		if (!fs.existsSync(filePath)) {
			for (const d of fileDecls) {
				result.skipped.push({ declaration: d, reason: "file not found" });
			}
			continue;
		}

		const original = fs.readFileSync(filePath, "utf-8");
		const sourceFile = ts.createSourceFile(filePath, original, ts.ScriptTarget.Latest, true);

		const originalHadSyntaxErrors = hasSyntaxDiagnostics(filePath, original);

		const pending: PendingRemoval[] = [];
		const pendingSkips: Array<{ declaration: UnusedDeclaration; reason: string }> = [];

		for (const decl of fileDecls) {
			let matched: MatchResult | SkipResult | NoneResult = { type: "none" };
			for (const statement of sourceFile.statements) {
				const attempt = matchStatement(sourceFile, statement, original, decl);
				if (attempt.type !== "none") {
					matched = attempt;
					break;
				}
			}

			if (matched.type === "match") {
				pending.push(matched.removal);
			} else if (matched.type === "skip") {
				pendingSkips.push({ declaration: matched.declaration, reason: matched.reason });
			} else {
				// Not found at top level — probably inside a namespace/module or
				// already removed. Skip quietly.
				pendingSkips.push({ declaration: decl, reason: "declaration not found at top level" });
			}
		}

		if (pending.length === 0) {
			for (const s of pendingSkips) result.skipped.push(s);
			continue;
		}

		const updated = applyRemovals(original, pending);
		// If file ends up empty or whitespace-only, normalize to a single newline.
		const normalized = updated.trim() === "" ? "\n" : updated;

		if (!originalHadSyntaxErrors && hasSyntaxDiagnostics(filePath, normalized)) {
			// Revert: do not write, and mark every pending decl as skipped.
			for (const p of pending) {
				result.skipped.push({
					declaration: p.declaration,
					reason: "removal would break file syntax",
				});
			}
			for (const s of pendingSkips) result.skipped.push(s);
			continue;
		}

		if (normalized !== original) {
			fs.writeFileSync(filePath, normalized);
			result.removed += pending.length;
		}
		for (const s of pendingSkips) result.skipped.push(s);
	}

	return result;
};
