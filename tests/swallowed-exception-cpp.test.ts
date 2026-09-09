import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectSwallowedExceptions } from "../src/engines/ai-slop/exceptions.js";
import type { EngineContext } from "../src/engines/types.js";

const ctx = (root: string): EngineContext => ({
	rootDirectory: root,
	languages: ["cpp"],
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

describe("detectSwallowedExceptions (C/C++)", () => {
	it("flags an empty catch in a .cpp file but not a commented one", async () => {
		const flagged = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-swcpp-"));
		const ok = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-swcpp-"));
		write(flagged, "a.cpp", "try { g(); } catch (...) {}\n");
		write(ok, "b.cpp", "try { g(); } catch (...) { /* expected */ }\n");
		const fa = await detectSwallowedExceptions(ctx(flagged));
		const fb = await detectSwallowedExceptions(ctx(ok));
		expect(fa.map((d) => d.rule)).toContain("ai-slop/swallowed-exception");
		expect(fb.map((d) => d.rule)).not.toContain("ai-slop/swallowed-exception");
	});

	it("treats a line-commented catch body as documented, like C# does", async () => {
		const ok = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-swcpp-"));
		write(ok, "c.cpp", "try { g(); } catch (...) {\n  // expected: device may be gone\n}\n");
		const findings = await detectSwallowedExceptions(ctx(ok));
		expect(findings.map((d) => d.rule)).not.toContain("ai-slop/swallowed-exception");
	});
});
