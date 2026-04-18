import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ts from "typescript";
import {
	diagnosticsToDeclarations,
	removeUnusedDeclarations,
	type UnusedDeclaration,
} from "../../src/engines/code-quality/unused-removal.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-unused-removal-"));
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
	) as ts.SourceFile & ParseDiagnosticsCarrier;
	const diagnostics = sf.parseDiagnostics ?? [];
	expect(diagnostics, `file ${filePath} should parse without syntax errors`).toHaveLength(0);
};

const findLine = (content: string, needle: string): number => {
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes(needle)) return i + 1;
	}
	throw new Error(`needle not found: ${needle}`);
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("removeUnusedDeclarations", () => {
	it("removes a standalone unused arrow-function const", () => {
		const source = `export const used = 1;
const unusedFn = (x: number): number => {
	return x * 2;
};
`;
		const file = writeFixture("arrow.ts", source);
		const decl: UnusedDeclaration = {
			filePath: file,
			line: findLine(source, "unusedFn"),
			column: 7,
			name: "unusedFn",
			kind: "variable",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(1);
		expect(result.skipped).toHaveLength(0);

		const after = fs.readFileSync(file, "utf-8");
		expect(after).not.toContain("unusedFn");
		expect(after).not.toContain("return x * 2");
		expect(after).toContain("export const used = 1");
		assertParsesClean(file);
	});

	it("removes an unused function declaration", () => {
		const source = `export const keep = true;
function unusedFoo() {
	return 42;
}
`;
		const file = writeFixture("func.ts", source);
		const decl: UnusedDeclaration = {
			filePath: file,
			line: findLine(source, "function unusedFoo"),
			column: 1,
			name: "unusedFoo",
			kind: "function",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(1);

		const after = fs.readFileSync(file, "utf-8");
		expect(after).not.toContain("unusedFoo");
		expect(after).not.toContain("return 42");
		assertParsesClean(file);
	});

	it("removes an unused class declaration", () => {
		const source = `export const x = 1;
class UnusedClass {
	greet() {
		return "hi";
	}
}
`;
		const file = writeFixture("class.ts", source);
		const decl: UnusedDeclaration = {
			filePath: file,
			line: findLine(source, "class UnusedClass"),
			column: 1,
			name: "UnusedClass",
			kind: "class",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(1);

		const after = fs.readFileSync(file, "utf-8");
		expect(after).not.toContain("UnusedClass");
		expect(after).not.toContain("greet()");
		assertParsesClean(file);
	});

	it("removes an unused type alias", () => {
		const source = `export const n = 3;
type UnusedAlias = string | number;
`;
		const file = writeFixture("alias.ts", source);
		const decl: UnusedDeclaration = {
			filePath: file,
			line: findLine(source, "UnusedAlias"),
			column: 1,
			name: "UnusedAlias",
			kind: "type",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(1);

		const after = fs.readFileSync(file, "utf-8");
		expect(after).not.toContain("UnusedAlias");
		assertParsesClean(file);
	});

	it("removes an unused interface declaration", () => {
		const source = `export const k = 1;
interface UnusedInterface {
	id: string;
	name: string;
}
`;
		const file = writeFixture("iface.ts", source);
		const decl: UnusedDeclaration = {
			filePath: file,
			line: findLine(source, "UnusedInterface"),
			column: 1,
			name: "UnusedInterface",
			kind: "interface",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(1);

		const after = fs.readFileSync(file, "utf-8");
		expect(after).not.toContain("UnusedInterface");
		expect(after).not.toContain("id: string");
		assertParsesClean(file);
	});

	it("removes an unused enum declaration", () => {
		const source = `export const flag = false;
enum UnusedEnum {
	A,
	B,
	C,
}
`;
		const file = writeFixture("enum.ts", source);
		const decl: UnusedDeclaration = {
			filePath: file,
			line: findLine(source, "UnusedEnum"),
			column: 1,
			name: "UnusedEnum",
			kind: "enum",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(1);

		const after = fs.readFileSync(file, "utf-8");
		expect(after).not.toContain("UnusedEnum");
		assertParsesClean(file);
	});

	it("skips a const whose initializer is a call expression (side-effect guard)", () => {
		const source = `declare function doThing(): number;
const unusedWithSideEffect = doThing();
export const other = 1;
`;
		const file = writeFixture("sideeffect.ts", source);
		const decl: UnusedDeclaration = {
			filePath: file,
			line: findLine(source, "unusedWithSideEffect"),
			column: 7,
			name: "unusedWithSideEffect",
			kind: "variable",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(0);
		expect(result.skipped).toHaveLength(1);
		expect(result.skipped[0].reason).toBe("initializer may have side effects");

		const after = fs.readFileSync(file, "utf-8");
		expect(after).toContain("unusedWithSideEffect");
		expect(after).toBe(source);
	});

	it("skips a multi-declarator variable statement", () => {
		const source = `const kept = 1, alsoUnused = 2;
export const used = kept;
`;
		const file = writeFixture("multi.ts", source);
		const decl: UnusedDeclaration = {
			filePath: file,
			line: findLine(source, "alsoUnused"),
			column: 1,
			name: "alsoUnused",
			kind: "variable",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(0);
		expect(result.skipped).toHaveLength(1);
		expect(result.skipped[0].reason).toBe("multi-declaration variable statement");

		const after = fs.readFileSync(file, "utf-8");
		expect(after).toBe(source);
	});

	it("removes multiple unused declarations in the same file in one pass", () => {
		const source = `export const used = 1;
const unusedA = 10;
const unusedB = 20;
type UnusedT = number;
interface UnusedI { a: number; }
`;
		const file = writeFixture("multi-decl.ts", source);
		const decls: UnusedDeclaration[] = [
			{
				filePath: file,
				line: findLine(source, "unusedA"),
				column: 7,
				name: "unusedA",
				kind: "variable",
			},
			{
				filePath: file,
				line: findLine(source, "unusedB"),
				column: 7,
				name: "unusedB",
				kind: "variable",
			},
			{
				filePath: file,
				line: findLine(source, "UnusedT"),
				column: 1,
				name: "UnusedT",
				kind: "type",
			},
			{
				filePath: file,
				line: findLine(source, "UnusedI"),
				column: 1,
				name: "UnusedI",
				kind: "interface",
			},
		];

		const result = removeUnusedDeclarations(tmpDir, decls);
		expect(result.removed).toBe(4);

		const after = fs.readFileSync(file, "utf-8");
		expect(after).not.toContain("unusedA");
		expect(after).not.toContain("unusedB");
		expect(after).not.toContain("UnusedT");
		expect(after).not.toContain("UnusedI");
		expect(after).toContain("export const used = 1");
		assertParsesClean(file);
	});

	it("does not touch declarations nested inside a namespace (top-level only)", () => {
		const source = `export const keep = 1;
namespace Outer {
	const innerUnused = 1;
}
`;
		const file = writeFixture("ns.ts", source);
		const decl: UnusedDeclaration = {
			filePath: file,
			line: findLine(source, "innerUnused"),
			column: 7,
			name: "innerUnused",
			kind: "variable",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(0);
		expect(result.skipped).toHaveLength(1);
		expect(result.skipped[0].reason).toBe("declaration not found at top level");

		const after = fs.readFileSync(file, "utf-8");
		expect(after).toContain("innerUnused");
		expect(after).toBe(source);
	});

	it("preserves JSDoc above a declaration — removes them together", () => {
		const source = `export const used = 1;
/**
 * A helper that's not actually used anywhere.
 */
const unusedHelper = (x: number) => x + 1;
`;
		const file = writeFixture("jsdoc.ts", source);
		const decl: UnusedDeclaration = {
			filePath: file,
			line: findLine(source, "unusedHelper"),
			column: 7,
			name: "unusedHelper",
			kind: "variable",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(1);

		const after = fs.readFileSync(file, "utf-8");
		expect(after).not.toContain("unusedHelper");
		expect(after).not.toContain("A helper that's not actually used");
		assertParsesClean(file);
	});

	it("treats arrow-function-valued const as safe to remove even if body calls other code", () => {
		const source = `declare function sideEffect(): void;
export const keep = 1;
const unusedArrow = () => {
	sideEffect();
};
`;
		const file = writeFixture("arrowbody.ts", source);
		const decl: UnusedDeclaration = {
			filePath: file,
			line: findLine(source, "unusedArrow"),
			column: 7,
			name: "unusedArrow",
			kind: "variable",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(1);
		expect(result.skipped).toHaveLength(0);

		const after = fs.readFileSync(file, "utf-8");
		expect(after).not.toContain("unusedArrow");
		// The arrow body's `sideEffect();` call is gone (the string still exists
		// as part of the `declare function sideEffect(): void;` signature above).
		expect(after).not.toMatch(/\tsideEffect\(\);/);
		expect(after).toContain("export const keep = 1");
		assertParsesClean(file);
	});

	it("removes an exported interface when the declaration signal says it is unused", () => {
		// knip's `knip/types` diagnostic reports an exported interface as an
		// unused "type". The engine must still remove it — the `export` keyword
		// is part of the node and gets stripped along with the body.
		const source = `export const keep = 1;
export interface UnusedExportedIface {
	id: string;
}
`;
		const file = writeFixture("exp-iface.ts", source);
		// Note: kind = "type" even though the statement is an InterfaceDeclaration.
		// This matches what knip emits ("Unused type: …") for interfaces.
		const decl: UnusedDeclaration = {
			filePath: file,
			line: findLine(source, "UnusedExportedIface"),
			column: 18,
			name: "UnusedExportedIface",
			kind: "type",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(1);
		expect(result.skipped).toHaveLength(0);

		const after = fs.readFileSync(file, "utf-8");
		expect(after).not.toContain("UnusedExportedIface");
		expect(after).not.toContain("id: string");
		expect(after).toContain("export const keep = 1");
		assertParsesClean(file);
	});

	it("removes an exported const declaration entirely (including the export keyword)", () => {
		const source = `export const keep = 1;
export const unusedExportedConst = 42;
`;
		const file = writeFixture("exp-const.ts", source);
		const decl: UnusedDeclaration = {
			filePath: file,
			line: findLine(source, "unusedExportedConst"),
			column: 14,
			name: "unusedExportedConst",
			kind: "variable",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(1);

		const after = fs.readFileSync(file, "utf-8");
		expect(after).not.toContain("unusedExportedConst");
		expect(after).toContain("export const keep = 1");
		assertParsesClean(file);
	});

	it("leaves non-matching declarations untouched when file has irrelevant unused names", () => {
		const source = `export const a = 1;
export const b = 2;
`;
		const file = writeFixture("noop.ts", source);
		const decl: UnusedDeclaration = {
			filePath: file,
			line: 1,
			column: 7,
			name: "doesNotExist",
			kind: "variable",
		};

		const result = removeUnusedDeclarations(tmpDir, [decl]);
		expect(result.removed).toBe(0);
		expect(result.skipped).toHaveLength(1);

		const after = fs.readFileSync(file, "utf-8");
		expect(after).toBe(source);
	});
});

describe("diagnosticsToDeclarations", () => {
	it("round-trips Unused <kind>: <name> messages into UnusedDeclaration records", () => {
		const decls = diagnosticsToDeclarations([
			{
				filePath: "a.ts",
				engine: "code-quality",
				rule: "code-quality/unused-declaration",
				severity: "warning",
				message: "Unused variable: foo",
				help: "",
				line: 12,
				column: 7,
				category: "Dead Code",
				fixable: true,
			},
			{
				filePath: "b.ts",
				engine: "code-quality",
				rule: "code-quality/unused-declaration",
				severity: "warning",
				message: "Unused type: Bar",
				help: "",
				line: 3,
				column: 1,
				category: "Dead Code",
				fixable: true,
			},
			{
				filePath: "c.ts",
				engine: "code-quality",
				rule: "code-quality/unused-declaration",
				severity: "warning",
				message: "Something completely different",
				help: "",
				line: 1,
				column: 1,
				category: "Dead Code",
				fixable: true,
			},
		]);

		expect(decls).toHaveLength(2);
		expect(decls[0]).toEqual({
			filePath: "a.ts",
			line: 12,
			column: 7,
			name: "foo",
			kind: "variable",
		});
		expect(decls[1]).toEqual({
			filePath: "b.ts",
			line: 3,
			column: 1,
			name: "Bar",
			kind: "type",
		});
	});
});
