// Shared types for the unused-removal engine. Re-exported by
// `unused-removal.ts` so external callers only need a single import path.

export type UnusedKind = "variable" | "function" | "class" | "type" | "interface" | "enum";

export interface UnusedDeclaration {
	/** Absolute or root-relative path to the source file */
	filePath: string;
	/** 1-based line number where the declaration starts */
	line: number;
	/** 1-based column number */
	column: number;
	/** Name of the declaration */
	name: string;
	/** The kind of declaration */
	kind: UnusedKind;
}

export interface RemovalResult {
	/** Number of declarations successfully removed */
	removed: number;
	/** Declarations that could not be safely removed (with reason) */
	skipped: Array<{ declaration: UnusedDeclaration; reason: string }>;
}
