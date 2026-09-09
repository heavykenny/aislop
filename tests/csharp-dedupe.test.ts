import { describe, expect, it } from "vitest";
import { dedupeCSharpAsync } from "../src/engines/csharp-dedupe.js";
import type { Diagnostic, EngineName, EngineResult } from "../src/engines/types.js";

const mk = (engine: EngineName, rule: string, filePath: string, line: number): Diagnostic => ({
	filePath,
	engine,
	rule,
	severity: "warning",
	message: "",
	help: "",
	line,
	column: 1,
	category: "",
	fixable: false,
});

describe("dedupeCSharpAsync", () => {
	it("drops the approximate ai-slop async finding when dotnet reports same file:line", () => {
		const results: EngineResult[] = [
			{
				engine: "ai-slop",
				diagnostics: [mk("ai-slop", "ai-slop/csharp-async-void", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
			{
				engine: "lint",
				diagnostics: [mk("lint", "dotnet/AsyncFixer03", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
		];
		const out = dedupeCSharpAsync(results);
		const aiSlop = out.find((r) => r.engine === "ai-slop");
		expect(aiSlop?.diagnostics).toHaveLength(0);
	});

	it("keeps the ai-slop finding when no dotnet finding overlaps", () => {
		const results: EngineResult[] = [
			{
				engine: "ai-slop",
				diagnostics: [mk("ai-slop", "ai-slop/csharp-async-void", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
			{ engine: "lint", diagnostics: [], elapsed: 0, skipped: false },
		];
		const out = dedupeCSharpAsync(results);
		expect(out.find((r) => r.engine === "ai-slop")?.diagnostics).toHaveLength(1);
	});

	it("drops the approximate finding at a nested-path location (proves the join key isn't fooled by path segments)", () => {
		const results: EngineResult[] = [
			{
				engine: "ai-slop",
				diagnostics: [mk("ai-slop", "ai-slop/csharp-sync-over-async", "src/Sub/Leak.cs", 42)],
				elapsed: 0,
				skipped: false,
			},
			{
				engine: "lint",
				diagnostics: [mk("lint", "dotnet/MA0042", "src/Sub/Leak.cs", 42)],
				elapsed: 0,
				skipped: false,
			},
		];
		const out = dedupeCSharpAsync(results);
		const aiSlop = out.find((r) => r.engine === "ai-slop");
		expect(aiSlop?.diagnostics).toHaveLength(0);
	});

	it("keeps non-approximate ai-slop findings even at a dotnet-reported location", () => {
		const results: EngineResult[] = [
			{
				engine: "ai-slop",
				diagnostics: [mk("ai-slop", "ai-slop/csharp-not-implemented", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
			{
				engine: "lint",
				diagnostics: [mk("lint", "dotnet/AsyncFixer03", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
		];
		const out = dedupeCSharpAsync(results);
		expect(out.find((r) => r.engine === "ai-slop")?.diagnostics).toHaveLength(1);
	});

	it("keeps the async-void finding when the coincidental overlap is an unrelated dotnet rule (IDISP001)", () => {
		const results: EngineResult[] = [
			{
				engine: "ai-slop",
				diagnostics: [mk("ai-slop", "ai-slop/csharp-async-void", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
			{
				engine: "lint",
				diagnostics: [mk("lint", "dotnet/IDISP001", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
		];
		const out = dedupeCSharpAsync(results);
		expect(out.find((r) => r.engine === "ai-slop")?.diagnostics).toHaveLength(1);
	});

	it("keeps the async-void finding when the coincidental overlap is an unrelated dotnet rule (CS0219)", () => {
		const results: EngineResult[] = [
			{
				engine: "ai-slop",
				diagnostics: [mk("ai-slop", "ai-slop/csharp-async-void", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
			{
				engine: "lint",
				diagnostics: [mk("lint", "dotnet/CS0219", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
		];
		const out = dedupeCSharpAsync(results);
		expect(out.find((r) => r.engine === "ai-slop")?.diagnostics).toHaveLength(1);
	});

	it("keeps the async-void finding when the overlapping dotnet rule is the sync-over-async analyzer, not the async-void one", () => {
		const results: EngineResult[] = [
			{
				engine: "ai-slop",
				diagnostics: [mk("ai-slop", "ai-slop/csharp-async-void", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
			{
				engine: "lint",
				diagnostics: [mk("lint", "dotnet/MA0042", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
		];
		const out = dedupeCSharpAsync(results);
		expect(out.find((r) => r.engine === "ai-slop")?.diagnostics).toHaveLength(1);
	});

	it("keeps the sync-over-async finding when the overlapping dotnet rule is the async-void analyzer, not a sync-over-async one", () => {
		const results: EngineResult[] = [
			{
				engine: "ai-slop",
				diagnostics: [mk("ai-slop", "ai-slop/csharp-sync-over-async", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
			{
				engine: "lint",
				diagnostics: [mk("lint", "dotnet/AsyncFixer03", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
		];
		const out = dedupeCSharpAsync(results);
		expect(out.find((r) => r.engine === "ai-slop")?.diagnostics).toHaveLength(1);
	});

	it("drops the sync-over-async finding when the overlapping dotnet rule is AsyncFixer02", () => {
		const results: EngineResult[] = [
			{
				engine: "ai-slop",
				diagnostics: [mk("ai-slop", "ai-slop/csharp-sync-over-async", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
			{
				engine: "lint",
				diagnostics: [mk("lint", "dotnet/AsyncFixer02", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
		];
		const out = dedupeCSharpAsync(results);
		expect(out.find((r) => r.engine === "ai-slop")?.diagnostics).toHaveLength(0);
	});

	it("drops the sync-over-async finding when the overlapping dotnet rule is MA0045", () => {
		const results: EngineResult[] = [
			{
				engine: "ai-slop",
				diagnostics: [mk("ai-slop", "ai-slop/csharp-sync-over-async", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
			{
				engine: "lint",
				diagnostics: [mk("lint", "dotnet/MA0045", "A.cs", 10)],
				elapsed: 0,
				skipped: false,
			},
		];
		const out = dedupeCSharpAsync(results);
		expect(out.find((r) => r.engine === "ai-slop")?.diagnostics).toHaveLength(0);
	});
});
