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

// C# verbatim and raw string literals delimit their bodies differently from the
// generic quoted-string form. When the scanner picks the wrong end, braces,
// comment markers and loop keywords from inside the literal stay visible to the
// function-boundary, nesting and concatenation passes that read masked source.
describe("maskStringsAndComments understands C# string literals", () => {
	it("keeps executable interpolation expressions while masking literal text", () => {
		const src = 'var value = $"label: {GetAsync().Result}";';
		const out = maskStringsAndComments(src, ".cs");

		expect(out).toContain("GetAsync().Result");
		expect(out).not.toContain("label");
		expect(out).not.toContain("{");
	});

	it("masks nested string contents inside an interpolation expression", () => {
		const src = 'var value = $"{Format("GetAsync().Result")}";';
		const out = maskStringsAndComments(src, ".cs");

		expect(out).toContain("Format");
		expect(out).not.toContain("GetAsync().Result");
	});

	it("treats a backslash before the closing quote of a verbatim string as literal", () => {
		const src = ["void M() {", '\tvar p = @"C:\\temp\\";', "\tif (x) { Go(); }", "}", ""].join(
			"\n",
		);
		const out = maskStringsAndComments(src, ".cs").split("\n");
		expect(out[1]).not.toContain("temp");
		// The literal closes on its own line: two delimiters, statement intact.
		expect(out[1]).toBe(`\tvar p = @"${" ".repeat(8)}";`);
		expect(out[2]).toContain("if (x) { Go(); }");
	});

	it("masks every line of a multiline verbatim string", () => {
		const src = [
			"void M() {",
			'\tvar sql = @"SELECT *',
			"} while (true) {",
			'// still inside the literal";',
			"\tvar s = 1;",
			"}",
			"",
		].join("\n");
		const out = maskStringsAndComments(src, ".cs").split("\n");
		expect(out).toHaveLength(src.split("\n").length);
		expect(out[2].trim()).toBe("");
		expect(out[3]).not.toContain("still inside");
		expect(out[4]).toContain("var s = 1;");
		expect(out[5]).toBe("}");
	});

	it("does not let a doubled quote inside a verbatim string end it early", () => {
		const src = ['var s = @"a "" { "" b";', "if (q) { Go(); }", ""].join("\n");
		const out = maskStringsAndComments(src, ".cs").split("\n");
		expect(out[0]).not.toContain("{");
		// Escaped quotes are blanked with the rest of the body, so only the two
		// real delimiters survive and a quote count stays balanced.
		expect(out[0].split('"')).toHaveLength(3);
		expect(out[1]).toContain("if (q) { Go(); }");
	});

	it("handles both interpolated verbatim prefix orders", () => {
		for (const prefix of ["$@", "@$"]) {
			const src = [`var s = ${prefix}"{name} \\ "" {";`, "if (q) { Go(); }", ""].join("\n");
			const out = maskStringsAndComments(src, ".cs").split("\n");
			expect(out[0]).not.toContain("{");
			expect(out[1]).toContain("{ Go(); }");
		}
	});

	it("masks the body of a multiline raw string literal", () => {
		const src = [
			"void M() {",
			'\tvar t = """',
			"} while (true) {",
			'""";',
			"\tvar s = 1;",
			"}",
			"",
		].join("\n");
		const out = maskStringsAndComments(src, ".cs").split("\n");
		expect(out[2].trim()).toBe("");
		expect(out[3]).toBe('""";');
		expect(out[4]).toContain("var s = 1;");
	});

	it("closes a raw string only on a quote run at least as long as the opening", () => {
		const src = ['var t = """"a """ b"""";', "if (q) { Go(); }", ""].join("\n");
		const out = maskStringsAndComments(src, ".cs").split("\n");
		// Body is `a """ b`: the inner three-quote run is content, not a delimiter.
		expect(out[0]).toBe(`var t = """"${" ".repeat(7)}"""";`);
		expect(out[1]).toContain("{ Go(); }");
	});

	it("does not end an interpolated string on a quote inside an interpolation hole", () => {
		// `string.Join(", ", ...)` inside a hole is idiomatic C#. Reading its
		// opening quote as the end of the enclosing literal leaves the rest of
		// the literal text exposed as if it were code.
		const src = ['var s = $"n={string.Join(", ", items)} done";', "if (q) { Go(); }", ""].join(
			"\n",
		);
		const out = maskStringsAndComments(src, ".cs").split("\n");
		expect(out[0]).toContain("string.Join");
		expect(out[0]).toContain("items");
		expect(out[0]).not.toContain('", "');
		expect(out[0]).not.toContain("done");
		expect(out[1]).toContain("{ Go(); }");
	});

	it("masks a brace that a nested literal contributes inside an interpolation hole", () => {
		const src = ['var s = $"a {J("{", x)} b";', "if (q) { Go(); }", ""].join("\n");
		const out = maskStringsAndComments(src, ".cs").split("\n");
		expect(out[0]).not.toContain("{");
		expect(out[1]).toContain("{ Go(); }");
	});

	it("treats a doubled brace as literal text rather than an interpolation hole", () => {
		const src = ['var s = $"{{literal}} {v} // no";', "if (q) { Go(); }", ""].join("\n");
		const out = maskStringsAndComments(src, ".cs").split("\n");
		expect(out[0]).toContain("v");
		expect(out[0]).not.toContain("literal");
		expect(out[0]).not.toContain("// no");
		expect(out[0]).not.toContain("{");
		expect(out[1]).toContain("{ Go(); }");
	});

	it("skips nested literals in the hole of a raw interpolated string", () => {
		const src = ['var t = $"""x {J("\\"", y)} z""";', "if (q) { Go(); }", ""].join("\n");
		const out = maskStringsAndComments(src, ".cs").split("\n");
		expect(out[0]).toContain("J");
		expect(out[0]).toContain("y");
		expect(out[0]).not.toContain("\\");
		expect(out[0]).not.toContain("{");
		expect(out[1]).toContain("{ Go(); }");
	});

	it("masks the whole body of a string left unterminated at end of line", () => {
		// The last body character used to survive, so a trailing brace on a
		// truncated line leaked into the nesting pass.
		const src = ['var s = "abc {', "if (q) { Go(); }", ""].join("\n");
		const out = maskStringsAndComments(src, ".cs").split("\n");
		expect(out[0]).toBe(`var s = "${" ".repeat(5)}`);
		expect(out[1]).toContain("{ Go(); }");
	});

	it("leaves an at-escaped keyword identifier alone", () => {
		const src = ["var @class = 1;", "if (@class) { Go(); }", ""].join("\n");
		const out = maskStringsAndComments(src, ".cs").split("\n");
		expect(out[0]).toBe("var @class = 1;");
		expect(out[1]).toBe("if (@class) { Go(); }");
	});

	it("masks a char literal holding a brace without desyncing on an escaped quote", () => {
		const src = [
			"void M() {",
			"\tvar open = '{';",
			"\tvar tick = '\\'';",
			"\tif (x) { Go(); }",
			"}",
			"",
		].join("\n");
		const out = maskStringsAndComments(src, ".cs").split("\n");
		expect(out[1]).not.toContain("{");
		expect(out[3]).toContain("if (x) { Go(); }");
	});
});

describe("maskStringsAndComments understands C++ raw string literals", () => {
	it("masks quotes and detector tokens inside a raw string", () => {
		const src = 'const char* text = R"(say "NULL")"; int* value = nullptr;';
		const out = maskStringsAndComments(src, ".cpp");

		expect(out).not.toContain("NULL");
		expect(out).toContain("int* value = nullptr;");
	});

	it("closes a raw string with its custom delimiter", () => {
		const src = 'const char* text = R"tag(NULL "quoted")tag"; int value = 1;';
		const out = maskStringsAndComments(src, ".cpp");

		expect(out).not.toContain("NULL");
		expect(out).toContain("int value = 1;");
	});
});

describe("maskComments keeps C# literal bodies readable", () => {
	it("does not treat comment markers inside a multiline verbatim string as comments", () => {
		const src = [
			'var sql = @"SELECT *',
			"/* still inside the literal */",
			'// also inside";',
			'var q = "kept"; // dropped',
			"",
		].join("\n");
		const out = maskComments(src, ".cs");
		expect(out).toContain("still inside the literal");
		expect(out).toContain("also inside");
		expect(out).toContain("kept");
		expect(out).not.toContain("dropped");
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
