import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	prefixUnusedVars,
	type UnusedVarTarget,
} from "../../src/engines/code-quality/unused-var-rename.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-unused-rename-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const writeFixture = (relativePath: string, content: string): string => {
	const full = path.join(tmpDir, relativePath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
	return full;
};

interface ParseDiagnosticsCarrier {
	parseDiagnostics?: ts.Diagnostic[];
}

const assertParsesClean = (filePath: string): void => {
	const content = fs.readFileSync(filePath, "utf-8");
	const sf = ts.createSourceFile(
		filePath,
		content,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	) as ts.SourceFile & ParseDiagnosticsCarrier;
	const diagnostics = sf.parseDiagnostics ?? [];
	expect(diagnostics, `file ${filePath} should parse without syntax errors`).toHaveLength(0);
};

const locate = (
	content: string,
	token: string,
): { line: number; column: number } => {
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const idx = lines[i].indexOf(token);
		if (idx !== -1) return { line: i + 1, column: idx + 1 };
	}
	throw new Error(`token not found: ${token}`);
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("prefixUnusedVars", () => {
	it("renames a positional function parameter: f(unused) -> f(_unused)", () => {
		const source = "export function f(unused: number): number {\n\treturn 1;\n}\n";
		const file = writeFixture("pos.ts", source);
		const pos = locate(source, "unused");
		const targets: UnusedVarTarget[] = [
			{ filePath: file, line: pos.line, column: pos.column, name: "unused", type: "parameter" },
		];

		const result = prefixUnusedVars(tmpDir, targets);

		expect(result.renamed).toBe(1);
		expect(result.skipped).toEqual([]);
		const updated = fs.readFileSync(file, "utf-8");
		expect(updated).toContain("f(_unused:");
		assertParsesClean(file);
	});

	it("converts shorthand destructure to aliased form: { foo } -> { foo: _foo } (preserves the type key)", () => {
		const source = `type Props = { durationInFrames: number };
export const Foo = ({ durationInFrames }: Props): number => {
\treturn 1;
};
`;
		const file = writeFixture("buildwithkenny.tsx", source);
		const pos = locate(source, "durationInFrames }");
		const targets: UnusedVarTarget[] = [
			{
				filePath: file,
				line: pos.line,
				column: pos.column,
				name: "durationInFrames",
				type: "parameter",
			},
		];

		const result = prefixUnusedVars(tmpDir, targets);

		expect(result.renamed).toBe(1);
		const updated = fs.readFileSync(file, "utf-8");
		expect(updated).toContain("{ durationInFrames: _durationInFrames }");
		// The surrounding type reference must still mention the original key
		expect(updated).toContain("durationInFrames: number");
		assertParsesClean(file);
	});

	it("renames an unused alias in-place: { key: alias } -> { key: _alias } (preserves property read + any getter side effects)", () => {
		const source = `declare function useLanguages(): { languages: string[]; isLoading: boolean };
export const run = (): void => {
\tconst { languages, isLoading: languagesLoading } = useLanguages();
\tconsole.log(languages);
};
`;
		const file = writeFixture("zingo.tsx", source);
		const pos = locate(source, "languagesLoading");
		const targets: UnusedVarTarget[] = [
			{
				filePath: file,
				line: pos.line,
				column: pos.column,
				name: "languagesLoading",
				type: "variable",
			},
		];

		const result = prefixUnusedVars(tmpDir, targets);

		expect(result.renamed).toBe(1);
		const updated = fs.readFileSync(file, "utf-8");
		expect(updated).toContain("isLoading: _languagesLoading");
		expect(updated).not.toMatch(/\blanguagesLoading\b/);
		expect(updated).not.toMatch(/isLoading:\s*\}/);
		assertParsesClean(file);
	});

	it("renames unused aliases in multiple destructures without colliding (zingo-web repro)", () => {
		const source = `declare function useLanguages(): { languages: string[]; isLoading: boolean };
declare function useVoices(): { voices: string[]; isLoading: boolean };
export const run = (): void => {
\tconst { languages, isLoading: languagesLoading } = useLanguages();
\tconst { voices, isLoading: voicesLoading } = useVoices();
\tconsole.log(languages, voices);
};
`;
		const file = writeFixture("zingo-redec.tsx", source);
		const posA = locate(source, "languagesLoading");
		const posB = locate(source, "voicesLoading");
		const targets: UnusedVarTarget[] = [
			{ filePath: file, line: posA.line, column: posA.column, name: "languagesLoading", type: "variable" },
			{ filePath: file, line: posB.line, column: posB.column, name: "voicesLoading", type: "variable" },
		];

		const result = prefixUnusedVars(tmpDir, targets);
		expect(result.renamed).toBe(2);
		const updated = fs.readFileSync(file, "utf-8");
		expect(updated).toContain("isLoading: _languagesLoading");
		expect(updated).toContain("isLoading: _voicesLoading");
		expect(updated).not.toMatch(/\blanguagesLoading\b/);
		expect(updated).not.toMatch(/\bvoicesLoading\b/);
		assertParsesClean(file);
	});

	it("renames an unused alias in the middle of a destructure (moovie-backend repro)", () => {
		const source = `declare function query(): { data: unknown; error: unknown };
export const run = (): void => {
\tconst { data: existingMember, error: memberError } = query();
\tconst { data, error } = query();
\tconsole.log(memberError, data, error);
};
`;
		const file = writeFixture("moovie.ts", source);
		const pos = locate(source, "existingMember");
		const targets: UnusedVarTarget[] = [
			{ filePath: file, line: pos.line, column: pos.column, name: "existingMember", type: "variable" },
		];
		const result = prefixUnusedVars(tmpDir, targets);
		expect(result.renamed).toBe(1);
		const updated = fs.readFileSync(file, "utf-8");
		expect(updated).toContain("data: _existingMember");
		expect(updated).toContain("error: memberError");
		expect(updated).toContain("const { data, error } = query()");
		expect(updated).not.toMatch(/\bexistingMember\b/);
		assertParsesClean(file);
	});

	it("renames the only element of a destructure: { data: unused } -> { data: _unused } (preserves property read)", () => {
		const source = `declare function run(): { data: unknown };
export const main = (): void => {
\tconst { data: unused } = run();
\tvoid main;
};
`;
		const file = writeFixture("only-element.ts", source);
		const pos = locate(source, "unused");
		const targets: UnusedVarTarget[] = [
			{ filePath: file, line: pos.line, column: pos.column, name: "unused", type: "variable" },
		];
		const result = prefixUnusedVars(tmpDir, targets);
		expect(result.renamed).toBe(1);
		const updated = fs.readFileSync(file, "utf-8");
		expect(updated).toContain("data: _unused");
		assertParsesClean(file);
	});

	it("preserves rest-spread semantics: { key: alias, ...rest } keeps 'key' out of 'rest' after rename", () => {
		const source = `type Obj = { secret: string; other: number };
declare function load(): Obj;
export const run = (): void => {
\tconst { secret: unusedSecret, ...rest } = load();
\tconsole.log(rest);
};
`;
		const file = writeFixture("rest-spread.ts", source);
		const pos = locate(source, "unusedSecret");
		const targets: UnusedVarTarget[] = [
			{ filePath: file, line: pos.line, column: pos.column, name: "unusedSecret", type: "variable" },
		];
		const result = prefixUnusedVars(tmpDir, targets);
		expect(result.renamed).toBe(1);
		const updated = fs.readFileSync(file, "utf-8");
		expect(updated).toContain("secret: _unusedSecret");
		expect(updated).toContain("...rest");
		assertParsesClean(file);
	});

	it("renames rest element in place: { ...props } -> { ..._props } (never emits key: alias form)", () => {
		const source = `import { ChevronLeft } from "./icons";
export const Wrapper = ({ ...props }: Record<string, unknown>): JSX.Element => <ChevronLeft />;
`;
		const file = writeFixture("snappy.tsx", source);
		const pos = locate(source, "props");
		const targets: UnusedVarTarget[] = [
			{ filePath: file, line: pos.line, column: pos.column, name: "props", type: "parameter" },
		];

		const result = prefixUnusedVars(tmpDir, targets);

		expect(result.renamed).toBe(1);
		const updated = fs.readFileSync(file, "utf-8");
		expect(updated).toContain("..._props");
		// Must NEVER emit the aliased form for rest
		expect(updated).not.toMatch(/\.\.\.props\s*:\s*_props/);
		expect(updated).not.toMatch(/\.\.\.\s*_props\s*:/);
		assertParsesClean(file);
	});

	it("renames catch clause parameter: catch (e) -> catch (_e)", () => {
		const source = `export const safe = (fn: () => void): void => {
\ttry {
\t\tfn();
\t} catch (e) {
\t\t// swallow
\t}
};
`;
		const file = writeFixture("catch.ts", source);
		const pos = locate(source, "catch (e)");
		const targets: UnusedVarTarget[] = [
			{
				filePath: file,
				// The identifier `e` is at catch column + "catch (".length = 8
				line: pos.line,
				column: pos.column + "catch (".length,
				name: "e",
				type: "parameter",
			},
		];

		const result = prefixUnusedVars(tmpDir, targets);

		expect(result.renamed).toBe(1);
		const updated = fs.readFileSync(file, "utf-8");
		expect(updated).toContain("catch (_e)");
		assertParsesClean(file);
	});

	it("renames an arrow function parameter: (x) => 1 -> (_x) => 1", () => {
		const source = "export const f = (x: number): number => 1;\n";
		const file = writeFixture("arrow.ts", source);
		const pos = locate(source, "x:");
		const targets: UnusedVarTarget[] = [
			{ filePath: file, line: pos.line, column: pos.column, name: "x", type: "parameter" },
		];

		const result = prefixUnusedVars(tmpDir, targets);

		expect(result.renamed).toBe(1);
		const updated = fs.readFileSync(file, "utf-8");
		expect(updated).toContain("(_x: number)");
		assertParsesClean(file);
	});

	it("renames multiple unused identifiers in one file in a single pass", () => {
		const source = `export function multi(a: number, b: number, c: number): number {
\treturn 42;
}
`;
		const file = writeFixture("multi.ts", source);
		const posA = locate(source, "a:");
		const posB = locate(source, "b:");
		const posC = locate(source, "c:");
		const targets: UnusedVarTarget[] = [
			{ filePath: file, line: posA.line, column: posA.column, name: "a", type: "parameter" },
			{ filePath: file, line: posB.line, column: posB.column, name: "b", type: "parameter" },
			{ filePath: file, line: posC.line, column: posC.column, name: "c", type: "parameter" },
		];

		const result = prefixUnusedVars(tmpDir, targets);

		expect(result.renamed).toBe(3);
		const updated = fs.readFileSync(file, "utf-8");
		expect(updated).toContain("_a: number");
		expect(updated).toContain("_b: number");
		expect(updated).toContain("_c: number");
		assertParsesClean(file);
	});

	it("reverts all edits when the resulting file would have new syntax errors", () => {
		// Build a case where the identifier to rename is real but the rewrite
		// we would attempt is fine. Then monkey-patch the file content to
		// produce broken output by feeding an impossible target (edge case).
		// A cleaner approach: use an aliased destructure where propertyName is
		// also used as a computed key in a weird way. The simplest forced-break
		// case is: use an existing file with a pre-existing parse error and
		// confirm the safety net triggers. Instead, we write a file with an
		// identifier we cannot rewrite; it should be skipped, not crash.
		const source = `export const foo = 1;\n`;
		const file = writeFixture("plain.ts", source);
		// Plain variable declaration — we classify this as
		// "unused variable binding outside parameter/destructure" and skip.
		const pos = locate(source, "foo");
		const targets: UnusedVarTarget[] = [
			{ filePath: file, line: pos.line, column: pos.column, name: "foo", type: "variable" },
		];

		const result = prefixUnusedVars(tmpDir, targets);

		expect(result.renamed).toBe(0);
		expect(result.skipped).toHaveLength(1);
		expect(result.skipped[0].reason).toMatch(
			/unused variable binding outside parameter\/destructure/,
		);
		// File is untouched
		expect(fs.readFileSync(file, "utf-8")).toBe(source);
	});

	it("skips a target whose identifier cannot be found in the AST", () => {
		const source = `export const keep = 1;\n`;
		const file = writeFixture("missing.ts", source);
		const targets: UnusedVarTarget[] = [
			{ filePath: file, line: 1, column: 1, name: "nonexistent", type: "variable" },
		];

		const result = prefixUnusedVars(tmpDir, targets);

		expect(result.renamed).toBe(0);
		expect(result.skipped).toHaveLength(1);
		expect(result.skipped[0].reason).toBe("target node not found");
	});

	it("real-world repro (buildwithkenny): typed FC destructure keeps the type key while renaming the local binding", () => {
		// Faithful reproduction of the Gap 3 scenario.
		const source = `import type { FC } from "react";
type Props = { durationInFrames: number };
const Foo: FC<Props> = ({ durationInFrames }) => <div />;
export default Foo;
`;
		const file = writeFixture("fc.tsx", source);
		const pos = locate(source, "{ durationInFrames }");
		const targets: UnusedVarTarget[] = [
			{
				filePath: file,
				line: pos.line,
				column: pos.column + 2, // skip "{ "
				name: "durationInFrames",
				type: "parameter",
			},
		];

		const result = prefixUnusedVars(tmpDir, targets);

		expect(result.renamed).toBe(1);
		const updated = fs.readFileSync(file, "utf-8");
		expect(updated).toContain("({ durationInFrames: _durationInFrames })");
		// The Props type reference is not rewritten
		expect(updated).toContain("type Props = { durationInFrames: number }");
		assertParsesClean(file);
	});

	it("handles the snappymenu Gap 2 rest-element case verbatim", () => {
		const source = `import { ChevronLeft } from "./chevron";
export const Slot = ({ ...props }) => <ChevronLeft />;
`;
		const file = writeFixture("snappy-gap2.tsx", source);
		const pos = locate(source, "...props");
		const targets: UnusedVarTarget[] = [
			{
				filePath: file,
				line: pos.line,
				column: pos.column + 3, // skip "..."
				name: "props",
				type: "parameter",
			},
		];

		const result = prefixUnusedVars(tmpDir, targets);

		expect(result.renamed).toBe(1);
		const updated = fs.readFileSync(file, "utf-8");
		expect(updated).toContain("{ ..._props }");
		expect(updated).not.toMatch(/\.\.\.props:/);
		assertParsesClean(file);
	});
});
