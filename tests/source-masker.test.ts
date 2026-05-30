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

	it("returns content unchanged for unknown extensions", () => {
		const src = "anything // not a comment here\n";
		expect(maskComments(src, ".txt")).toBe(src);
	});
});

describe("maskStringsAndComments still masks string bodies", () => {
	it("blanks string contents as well as comments", () => {
		const out = maskStringsAndComments(`const u = "https://api.example.com" // x\n`, ".ts");
		expect(out).not.toContain("https://api.example.com");
		expect(out).toContain("const u =");
	});
});
