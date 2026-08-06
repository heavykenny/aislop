import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectSwallowedExceptions } from "../src/engines/ai-slop/exceptions.js";
import { detectNarrativeComments } from "../src/engines/ai-slop/narrative-comments.js";
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

describe("C# reuse of language-agnostic engines", () => {
	it("flags an empty C# catch block", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-cs-exc-"));
		fs.writeFileSync(
			path.join(root, "A.cs"),
			"class A { void M() { try { Do(); } catch (Exception) { } } }",
		);
		const diags = await detectSwallowedExceptions(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/swallowed-exception")).toBe(true);
	});

	it("flags a narrative restatement comment above a C# method", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-cs-narr-"));
		fs.writeFileSync(
			path.join(root, "B.cs"),
			[
				"// This method processes the input and returns a result.",
				"public void DoThing()",
				"{",
				"}",
				"",
			].join("\n"),
		);
		const diags = await detectNarrativeComments(ctx(root));
		expect(diags.some((d) => d.rule === "ai-slop/narrative-comment")).toBe(true);
	});
});
