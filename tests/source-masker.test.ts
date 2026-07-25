import { describe, expect, it } from "vitest";
import { maskComments, maskStringsAndComments } from "../src/utils/source-masker.js";

describe("maskComments", () => {
	it("blanks a line comment but keeps the code before it", () => {
		const out = maskComments("const a = 1; // console.log(2)\n", ".ts");
		expect(out).toContain("const a = 1;");
		expect(out).not.toContain("console");
	});

	it("blanks a JSDoc block, including code inside @example", () => {
		const src = `/**\n * @example\n * import {And} from "type-fest";\n */\nexport const z = 1\n`;
		const out = maskComments(src, ".ts");
		expect(out).not.toContain("import {And}");
		expect(out).toContain("export const z = 1");
	});

	it("preserves string contents (URLs, specifiers) so code rules still see them", () => {
		const out = maskComments(`const u = "https://api.example.com"\n`, ".ts");
		expect(out).toContain("https://api.example.com");
	});

	it("does not treat // inside a string literal as a comment", () => {
		const out = maskComments(`const p = "a//b//c"\n`, ".ts");
		expect(out).toContain("a//b//c");
	});

	it("masks Python # comments while leaving code intact", () => {
		const out = maskComments("x = 1  # secret here\n", ".py");
		expect(out).toContain("x = 1");
		expect(out).not.toContain("secret here");
	});

	it("masks Go line and block comments while preserving strings", () => {
		const src = [
			`package main`,
			`const raw = \`a \${notInterpolation} raw string\``,
			`// postgres://raw:userpass@host/db`,
			`const dsn = "postgres://user:pass@localhost/db" // postgres://user:pass@host/db`,
			`/* secret = "inside comment" */`,
			``,
		].join("\n");
		const out = maskComments(src, ".go");
		expect(out).toContain("postgres://user:pass@localhost/db");
		expect(out).not.toContain("inside comment");
		expect(out).not.toContain("postgres://user:pass@host/db");
		expect(out).not.toContain("postgres://raw:userpass@host/db");
	});

	it("returns content unchanged for unknown extensions", () => {
		const src = "anything // not a comment here\n";
		expect(maskComments(src, ".txt")).toBe(src);
	});

	it("does not treat /* inside a regex character class as a block comment", () => {
		const src = [
			"function f() {",
			"  const re = /[/*]/;",
			"  return re.test('x');",
			"}",
			"const after = 1;",
			"",
		].join("\n");
		const out = maskComments(src, ".ts");
		expect(out).toContain("const after = 1;");
		expect(out).toContain("re.test");
	});

	it("still masks a line comment that follows a division", () => {
		const out = maskComments("const r = a / b // secret\n", ".ts");
		expect(out).toContain("a / b");
		expect(out).not.toContain("secret");
	});
});

describe("maskStringsAndComments still masks string bodies", () => {
	it("blanks string contents as well as comments", () => {
		const out = maskStringsAndComments(`const u = "https://api.example.com" // x\n`, ".ts");
		expect(out).not.toContain("https://api.example.com");
		expect(out).toContain("const u =");
	});
});

describe("maskStringsAndComments recognises regex literals", () => {
	// A regex whose body contains quotes/backticks/comment markers must not be read as
	// a string/template/comment; otherwise the scanner desyncs and blanks real code.
	it("does not let a quote inside a regex swallow following code", () => {
		const src = ["const re = /(?:`|[\"'])\\s*/;", 'const kept = "after";', ""].join("\n");
		const out = maskStringsAndComments(src, ".ts");
		// The regex body is blanked, but the statement after it survives intact.
		expect(out).toContain("const re =");
		expect(out).toContain("const kept =");
		expect(out).not.toContain("after");
	});

	it("keeps braces after a regex balanced (regex braces are not block delimiters)", () => {
		const src = ["function f() {", "  return /^}\\s*{/.test(x);", "}", "const y = 2;"].join("\n");
		const out = maskStringsAndComments(src, ".ts").split("\n");
		// The regex on line 2 (with `}` and `{`) is blanked, so only the real braces remain.
		const braceLine = out[1];
		expect(braceLine).not.toContain("}");
		expect(braceLine).not.toContain("{");
		expect(out[0]).toContain("function f()");
	});

	it("still treats division as division (not a regex)", () => {
		const out = maskStringsAndComments("const r = a / b + c;\n", ".ts");
		expect(out).toContain("const r = a / b + c;");
	});
});
