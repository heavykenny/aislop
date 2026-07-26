import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectCSharpPatterns } from "../src/engines/ai-slop/csharp-patterns.js";
import type { EngineContext } from "../src/engines/types.js";

const ctx = (root: string): EngineContext => ({
	rootDirectory: root,
	languages: ["csharp"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

const write = (root: string, name: string, body: string) => {
	fs.writeFileSync(path.join(root, name), body);
};

describe("csharp-patterns: NotImplementedException", () => {
	it("flags throw new NotImplementedException()", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { int M() { throw new NotImplementedException(); } }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-not-implemented")).toBe(true);
	});

	it("does not flag inside a comment", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { // throw new NotImplementedException();\n }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-not-implemented")).toBe(false);
	});
});

describe("csharp-patterns: redundant XML-doc", () => {
	it("flags a Gets/Sets boilerplate summary", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"B.cs",
			[
				"/// <summary>Gets or sets the name.</summary>",
				"public string Name { get; set; }",
				"",
			].join("\n"),
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-redundant-doc-comment")).toBe(true);
	});

	it("does not flag a summary with real explanatory content", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"C.cs",
			[
				"/// <summary>Caches results because recomputation is O(n^2).</summary>",
				"public string Name { get; set; }",
				"",
			].join("\n"),
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-redundant-doc-comment")).toBe(false);
	});
});

describe("csharp-patterns: async-void", () => {
	it("flags a plain async void method", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { async void DoWork() { await Task.Delay(1); } }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-async-void")).toBe(true);
	});

	it("does NOT flag an event-handler-shaped async void", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			"class A { async void OnClick(object sender, EventArgs e) { await Task.Delay(1); } }",
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-async-void")).toBe(false);
	});
});

describe("csharp-patterns: sync-over-async", () => {
	it("flags .Result", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { void M() { var x = GetAsync().Result; } }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-sync-over-async")).toBe(true);
	});

	it("does NOT flag when an intent comment precedes it", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			[
				"class A { void M() {",
				"// safe: task already completed",
				"var x = GetAsync().Result; } }",
			].join("\n"),
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-sync-over-async")).toBe(false);
	});
});

describe("csharp-patterns: suppressed-warning", () => {
	it("flags an unjustified #pragma warning disable", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "#pragma warning disable CS1591\nclass A { }\n");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-suppressed-warning")).toBe(true);
	});

	it("does NOT flag a pragma justified by a trailing comment", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "#pragma warning disable CS1591 // generated file\nclass A { }\n");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-suppressed-warning")).toBe(false);
	});

	it("does NOT flag a pragma justified by a preceding comment", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			"// docs not required for generated code\n#pragma warning disable CS1591\nclass A { }\n",
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-suppressed-warning")).toBe(false);
	});

	it("does NOT flag #pragma warning restore", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "#pragma warning restore CS1591\nclass A { }\n");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-suppressed-warning")).toBe(false);
	});

	it("flags [SuppressMessage] with a <Pending> placeholder justification", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			'[SuppressMessage("Usage", "CA2200", Justification = "<Pending>")]\nclass A { }\n',
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-suppressed-warning")).toBe(true);
	});

	it("does NOT flag [SuppressMessage] with a real justification", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			'[SuppressMessage("Usage", "CA2200", Justification = "rethrow preserves the original frame")]\nclass A { }\n',
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-suppressed-warning")).toBe(false);
	});
});

describe("csharp-patterns: empty-catch-rethrow", () => {
	it("flags a single-line catch that only rethrows", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { void M() { try { Do(); } catch (Exception) { throw; } } }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-empty-catch-rethrow")).toBe(true);
	});

	it("flags a multi-line catch that only rethrows", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			["try {", "  Do();", "} catch (Exception ex) {", "  throw;", "}"].join("\n"),
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-empty-catch-rethrow")).toBe(true);
	});

	it("does NOT flag a catch that logs before rethrow", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			["try { Do(); } catch (Exception ex) {", "  Log(ex);", "  throw;", "}"].join("\n"),
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-empty-catch-rethrow")).toBe(false);
	});

	it("does NOT flag a catch that wraps and rethrows", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			'class A { void M() { try { Do(); } catch (Exception ex) { throw new InvalidOperationException("x", ex); } } }',
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-empty-catch-rethrow")).toBe(false);
	});
});

describe("csharp-patterns: null-forgiving", () => {
	it("flags a `= null!` initializer", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { public string Name { get; set; } = null!; }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-null-forgiving")).toBe(true);
	});

	it("flags a use-site `foo!.Bar`", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { void M(B b) { var x = b!.Value; } }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-null-forgiving")).toBe(true);
	});

	it("does NOT flag `!=` inequality", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { bool M(int a, int b) { return a != b; } }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-null-forgiving")).toBe(false);
	});

	it("does NOT flag a prefix logical-not `!flag`", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { bool M(bool flag) { return !flag; } }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-null-forgiving")).toBe(false);
	});

	it("does NOT flag `!` inside a string literal", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", 'class A { string M() { return "done!"; } }');
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-null-forgiving")).toBe(false);
	});
});

describe("csharp-patterns: console-leftover (debug/trace)", () => {
	it("flags Debug.WriteLine", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", 'class A { void M() { Debug.WriteLine("here"); } }');
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-console-leftover")).toBe(true);
	});

	it("flags Trace.WriteLine", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", 'class A { void M() { Trace.WriteLine("here"); } }');
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-console-leftover")).toBe(true);
	});

	it("does NOT flag debug output under a test path", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		fs.mkdirSync(path.join(root, "tests"));
		write(root, path.join("tests", "A.cs"), 'class A { void M() { Debug.WriteLine("here"); } }');
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-console-leftover")).toBe(false);
	});
});

describe("csharp-patterns: console-leftover (Console.*)", () => {
	it("flags Console.WriteLine in a library project", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		fs.writeFileSync(path.join(root, "Lib.csproj"), "<Project></Project>");
		write(root, "A.cs", 'class A { void M() { Console.WriteLine("hi"); } }');
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-console-leftover")).toBe(true);
	});

	it("does NOT flag Console.WriteLine in an Exe project", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		fs.writeFileSync(
			path.join(root, "App.csproj"),
			"<Project><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>",
		);
		write(root, "A.cs", 'class A { void M() { Console.WriteLine("hi"); } }');
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-console-leftover")).toBe(false);
	});

	it("does NOT flag Console.Error.WriteLine even in a library", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		fs.writeFileSync(path.join(root, "Lib.csproj"), "<Project></Project>");
		write(root, "A.cs", 'class A { void M() { Console.Error.WriteLine("oops"); } }');
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-console-leftover")).toBe(false);
	});
});

describe("csharp-patterns: broad-catch", () => {
	it("flags a broad catch that drops the error (no variable)", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			"class A { object M() { try { F(); } catch (Exception) { return null; } } }",
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-broad-catch")).toBe(true);
	});

	it("flags a broad catch that declares but never references its variable", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			"class A { object M() { try { F(); } catch (Exception ex) { return null; } } }",
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-broad-catch")).toBe(true);
	});

	it("does NOT flag catch-and-log that references the caught variable", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { void M() { try { F(); } catch (Exception ex) { Log(ex); } } }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-broad-catch")).toBe(false);
	});

	it("does NOT flag catch-and-log that references the variable inside an interpolated string", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			'class A { void M() { try { F(); } catch (Exception ex) { Log($"failed: {ex.Message}"); } } }',
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-broad-catch")).toBe(false);
	});

	it("does not cross into a sibling catch body when bounding the error reference", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			[
				"class A {",
				"  void M1() {",
				"    try { F(); }",
				"    catch (Exception exception) { return; }",
				"  }",
				"  void M2() {",
				"    try { F(); }",
				"    catch (Exception exception) { Log(exception); }",
				"  }",
				"}",
			].join("\n"),
		);
		const diags = await detectCSharpPatterns(ctx(root));
		const broad = diags.filter((d) => d.rule === "ai-slop/csharp-broad-catch");
		expect(broad.length).toBe(1);
		expect(broad[0].line).toBe(4);
	});

	it("does NOT flag a specific exception type", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			"class A { void M() { try { F(); } catch (IOException ex) { Log(ex); } } }",
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-broad-catch")).toBe(false);
	});

	it("does NOT flag a catch (Exception) with a when filter", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			"class A { void M() { try { F(); } catch (Exception ex) when (ex is IOException) { Log(ex); } } }",
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-broad-catch")).toBe(false);
	});

	it("does NOT double-flag an empty or rethrow-only broad catch", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			[
				"class A {",
				"  void M() {",
				"    try { F(); } catch (Exception) { throw; }",
				"  }",
				"}",
			].join("\n"),
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-broad-catch")).toBe(false);
	});
});

describe("csharp-patterns: LINQ count vs Any", () => {
	it("flags .Count() > 0", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { bool M() { return items.Count() > 0; } }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-linq-count")).toBe(true);
	});

	it("flags .Count() == 0", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { bool M() { return items.Count() == 0; } }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-linq-count")).toBe(true);
	});

	it("does NOT flag the O(1) .Count property without parentheses", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { bool M() { return list.Count > 0; } }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-linq-count")).toBe(false);
	});

	it("does NOT flag .Count() compared to a larger number", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { bool M() { return items.Count() > 10; } }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-linq-count")).toBe(false);
	});
});

describe("csharp-patterns: index loop vs foreach", () => {
	it("flags for (int i = 0; i < arr.Length; i++)", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			"class A { void M() { for (int i = 0; i < arr.Length; i++) { Use(arr[i]); } } }",
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-index-loop")).toBe(true);
	});

	it("does NOT flag a loop that does not start at 0 / walk Length", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", "class A { void M() { for (int i = 1; i < n; i++) { Use(i); } } }");
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-index-loop")).toBe(false);
	});

	it("does NOT flag when the index feeds a nested look-ahead loop (used beyond arr[i])", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			"class A { void M() { for (int i = 0; i < args.Length; i++) { for (int j = i + 1; j < args.Length; j++) { Use(args[j]); } } } }",
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-index-loop")).toBe(false);
	});

	it("does NOT flag when the index itself is used (logged) alongside element access", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			"class A { void M() { for (int i = 0; i < arr.Length; i++) { Log(i); Use(arr[i]); } } }",
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-index-loop")).toBe(false);
	});
});

describe("csharp-patterns: if/else-if ladder", () => {
	it("flags a 4+ branch ladder on the same variable", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			[
				"class A {",
				"  string M(string kind) {",
				'    if (kind == "a") return "1";',
				'    else if (kind == "b") return "2";',
				'    else if (kind == "c") return "3";',
				'    else if (kind == "d") return "4";',
				'    return "0";',
				"  }",
				"}",
			].join("\n"),
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-if-ladder")).toBe(true);
	});

	it("does NOT flag a short 2-branch if/else", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			[
				"class A {",
				"  string M(string kind) {",
				'    if (kind == "a") return "1";',
				'    else if (kind == "b") return "2";',
				'    return "0";',
				"  }",
				"}",
			].join("\n"),
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-if-ladder")).toBe(false);
	});
});

describe("csharp-patterns: aislop-worker exemption", () => {
	it("does NOT flag Console.WriteLine in a file marked // aislop-worker", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		fs.writeFileSync(path.join(root, "Lib.csproj"), "<Project></Project>");
		write(
			root,
			"Worker.cs",
			["// aislop-worker", 'class W { void M() { Console.WriteLine("{json}"); } }'].join("\n"),
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-console-leftover")).toBe(false);
	});

	it("STILL flags Debug.WriteLine in a worker file (stderr-style debug is a leftover)", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		fs.writeFileSync(path.join(root, "Lib.csproj"), "<Project></Project>");
		write(
			root,
			"Worker.cs",
			["// aislop-worker", 'class W { void M() { Debug.WriteLine("trace"); } }'].join("\n"),
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-console-leftover")).toBe(true);
	});
});

describe("csharp-patterns: string concat in loop", () => {
	it('flags s += "..." inside a foreach loop', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			[
				"class A {",
				"  string M(string[] xs) {",
				'    var result = "";',
				"    foreach (var x in xs) {",
				'      result += $"{x}, ";',
				"    }",
				"    return result;",
				"  }",
				"}",
			].join("\n"),
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-string-concat-in-loop")).toBe(true);
	});

	it("does NOT flag a string += outside any loop", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(root, "A.cs", ['class A { string M() { var s = "a"; s += "b"; return s; } }'].join("\n"));
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-string-concat-in-loop")).toBe(false);
	});

	it("does NOT flag a numeric += inside a loop (no string literal on the RHS)", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-csp-"));
		write(
			root,
			"A.cs",
			[
				"class A {",
				"  int M(int[] xs) {",
				"    int total = 0;",
				"    foreach (var x in xs) { total += x; }",
				"    return total;",
				"  }",
				"}",
			].join("\n"),
		);
		const diags = await detectCSharpPatterns(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/csharp-string-concat-in-loop")).toBe(false);
	});
});
