import { describe, expect, it } from "vitest";
import { canonicalCppRuleId, dedupeCppDiagnostics } from "../../src/engines/lint/index.js";
import type { Diagnostic } from "../../src/engines/types.js";

const make = (rule: string, file: string, line: number): Diagnostic => ({
	filePath: file,
	engine: "lint",
	rule,
	severity: "warning",
	message: "",
	help: "",
	line,
	column: 1,
	category: "C++ Lint",
	fixable: false,
});

describe("canonicalCppRuleId", () => {
	it("normalizes jb CppClangTidy* to kebab clang-tidy id", () => {
		expect(canonicalCppRuleId("jb/CppClangTidyBugproneNarrowingConversions")).toBe(
			"bugprone-narrowing-conversions",
		);
	});

	it("normalizes clang-tidy rule to same kebab id", () => {
		expect(canonicalCppRuleId("clang-tidy/bugprone-narrowing-conversions")).toBe(
			"bugprone-narrowing-conversions",
		);
	});

	it("passes non-clang-tidy jb cpp id through unchanged", () => {
		expect(canonicalCppRuleId("jb/CppCStyleCast")).toBe("CppCStyleCast");
	});
});

describe("dedupeCppDiagnostics", () => {
	it("collapses cppcheck and clang-tidy findings sharing file:line:bare-rule", () => {
		const result = dedupeCppDiagnostics([
			make("cppcheck/uninitvar", "src\\a.cpp", 5),
			make("clang-tidy/uninitvar", "src/a.cpp", 5), // same logical file+line+bare id
			make("cppcheck/nullPointer", "src/a.cpp", 9),
		]);
		expect(result).toHaveLength(2);
		expect(result[0].rule).toBe("cppcheck/uninitvar");
		expect(result[1].rule).toBe("cppcheck/nullPointer");
	});

	it("collapses jb CppClangTidy narrowing and clang-tidy narrowing at the same site", () => {
		const result = dedupeCppDiagnostics([
			make("jb/CppClangTidyBugproneNarrowingConversions", "src/a.cpp", 10),
			make("clang-tidy/bugprone-narrowing-conversions", "src/a.cpp", 10),
		]);
		expect(result).toHaveLength(1);
		expect(result[0].rule).toBe("jb/CppClangTidyBugproneNarrowingConversions");
	});

	it("does not collapse two genuinely different cpp issues at the same file:line", () => {
		const result = dedupeCppDiagnostics([
			make("jb/CppCStyleCast", "src/a.cpp", 10),
			make("clang-tidy/bugprone-narrowing-conversions", "src/a.cpp", 10),
		]);
		expect(result).toHaveLength(2);
	});
});
