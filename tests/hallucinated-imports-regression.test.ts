import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectHallucinatedImports } from "../src/engines/ai-slop/hallucinated-imports.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const buildContext = (): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["typescript", "javascript", "python"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-hi-regression-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("hallucinated-import regressions — still catches real slop after FP fixes", () => {
	it("still flags a truly undeclared package in a nested web package", async () => {
		writeFile("package.json", JSON.stringify({ name: "root", dependencies: {} }));
		writeFile(
			"web/package.json",
			JSON.stringify({ name: "web", dependencies: { "@docusaurus/core": "~3.10.1" } }),
		);
		writeFile("web/src/app.ts", `import { x } from "totally-fake-package-xyz";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("totally-fake-package-xyz");
	});

	it("still flags wasp imports outside a wasp project", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: { react: "^19.0.0" } }));
		writeFile("src/App.tsx", `import { useAuth } from "wasp/client/auth";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("wasp");
	});

	it("still flags @docusaurus virtual imports when docusaurus is not installed", async () => {
		writeFile("package.json", JSON.stringify({ name: "site", dependencies: { react: "^19.0.0" } }));
		writeFile("src/Link.tsx", `import Link from "@docusaurus/Link";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("@docusaurus/Link");
	});

	it("still flags real imports at file top level while ignoring template literal samples", async () => {
		writeFile("package.json", JSON.stringify({ name: "docs", dependencies: { react: "^19.0.0" } }));
		writeFile(
			"src/Hero.jsx",
			[
				`import { fake } from "real-hallucination-pkg";`,
				`const snippet = {`,
				`  source: \`import { getTasks } from "wasp/client/operations";\``,
				`};`,
				``,
			].join("\n"),
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("real-hallucination-pkg");
	});

	it("skips generator templates via non-production path", async () => {
		writeFile("package.json", JSON.stringify({ name: "root", dependencies: {} }));
		writeFile(
			"waspc/data/Generator/templates/sdk/app.ts",
			`import express from "express";\nimport { x } from "wasp/client/auth";\n`,
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toEqual([]);
	});
});