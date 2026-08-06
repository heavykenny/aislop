import { describe, expect, it } from "vitest";
import { dedupeOverlappingComments } from "../src/engines/comment-dedupe.js";
import type { Diagnostic, EngineResult } from "../src/engines/types.js";

const diag = (rule: string, line: number, filePath = "A.cs"): Diagnostic => ({
	filePath,
	engine: "ai-slop",
	rule,
	severity: "info",
	message: "",
	help: "",
	line,
	column: 1,
	category: "AI Slop",
	fixable: false,
});

const aiSlop = (diagnostics: Diagnostic[]): EngineResult => ({
	engine: "ai-slop",
	diagnostics,
	elapsed: 0,
	skipped: false,
});

describe("dedupeOverlappingComments", () => {
	it("keeps a single comment finding when two comment rules hit the same line", () => {
		const out = dedupeOverlappingComments([
			aiSlop([diag("ai-slop/narrative-comment", 5), diag("ai-slop/meta-comment", 5)]),
		]);
		expect(out[0].diagnostics).toHaveLength(1);
	});

	it("keeps both comment findings when they sit on different lines", () => {
		const out = dedupeOverlappingComments([
			aiSlop([diag("ai-slop/narrative-comment", 5), diag("ai-slop/meta-comment", 9)]),
		]);
		expect(out[0].diagnostics).toHaveLength(2);
	});

	it("does not drop a non-comment rule that shares a line with a comment rule", () => {
		const out = dedupeOverlappingComments([
			aiSlop([diag("ai-slop/narrative-comment", 5), diag("ai-slop/csharp-broad-catch", 5)]),
		]);
		expect(out[0].diagnostics).toHaveLength(2);
	});

	it("leaves non-ai-slop engines untouched", () => {
		const lintResult: EngineResult = {
			engine: "lint",
			diagnostics: [diag("dotnet/x", 5), diag("dotnet/x", 5)],
			elapsed: 0,
			skipped: false,
		};
		const out = dedupeOverlappingComments([lintResult]);
		expect(out[0].diagnostics).toHaveLength(2);
	});
});
