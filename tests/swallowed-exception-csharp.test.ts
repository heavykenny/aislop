import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectSwallowedExceptions } from "../src/engines/ai-slop/exceptions.js";
import type { EngineContext } from "../src/engines/types.js";

const ctx = (root: string): EngineContext => ({
	rootDirectory: root,
	languages: ["csharp"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false, expoDoctor: false },
	},
});

const write = (root: string, name: string, body: string) =>
	fs.writeFileSync(path.join(root, name), body);

const hasSwallowed = async (root: string): Promise<boolean> => {
	const diags = await detectSwallowedExceptions(ctx(root));
	return diags.some((d) => d.rule === "ai-slop/swallowed-exception");
};

describe("swallowed-exception: C# catch comment consistency", () => {
	it("flags a truly empty catch block", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-swc-"));
		write(
			root,
			"A.cs",
			["class A {", "  void M() {", "    try { F(); }", "    catch { }", "  }", "}"].join("\n"),
		);
		expect(await hasSwallowed(root)).toBe(true);
	});

	it("does NOT flag a catch documented with a line comment", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-swc-"));
		write(
			root,
			"A.cs",
			[
				"class A {",
				"  void M() {",
				"    try { F(); }",
				"    catch {",
				"      // best-effort: a throwing handler must not kill the watcher",
				"    }",
				"  }",
				"}",
			].join("\n"),
		);
		expect(await hasSwallowed(root)).toBe(false);
	});

	it("does NOT flag a catch documented with a block comment", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-swc-"));
		write(
			root,
			"A.cs",
			[
				"class A {",
				"  void M() {",
				"    try { F(); }",
				"    catch { /* best-effort: must not kill the watcher */ }",
				"  }",
				"}",
			].join("\n"),
		);
		expect(await hasSwallowed(root)).toBe(false);
	});
});
