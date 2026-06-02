import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectMetaComments } from "../src/engines/ai-slop/meta-comment.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-meta-comment-"));
});
afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ctx = (rootDirectory: string): EngineContext => ({
	rootDirectory,
	languages: ["typescript"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
	},
});

const writeFile = (relativePath: string, content: string): void => {
	const full = path.join(tmpDir, relativePath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
};

const metaDiags = async () => {
	const diags = await detectMetaComments(ctx(tmpDir));
	return diags.filter((d) => d.rule === "ai-slop/meta-comment");
};

describe("meta-comment: plan/process references", () => {
	it("flags `Stage 3` plan references", async () => {
		writeFile("src/a.ts", `// Stage 3: wire up the cache layer\nexport const x = 1;\n`);
		const diags = await metaDiags();
		expect(diags).toHaveLength(1);
		expect(diags[0].severity).toBe("warning");
		expect(diags[0].fixable).toBe(false);
		expect(diags[0].message).toContain("plan/process reference");
	});

	it("flags `per the spec` references", async () => {
		writeFile("src/b.ts", `// Validate the token per the spec before use\nexport const y = 2;\n`);
		expect(await metaDiags()).toHaveLength(1);
	});

	it("flags `from the task` references", async () => {
		writeFile("src/c.py", `# Implement this from the task description\ndef run():\n    pass\n`);
		expect(await metaDiags()).toHaveLength(1);
	});

	it("flags `as per the requirements doc`", async () => {
		writeFile("src/d.ts", `// Sort ascending as per the requirements doc\nexport const z = 3;\n`);
		expect(await metaDiags()).toHaveLength(1);
	});
});

describe("meta-comment: before/after state narration", () => {
	it("flags `previously this ...`", async () => {
		writeFile(
			"src/e.ts",
			`// Previously this used a Map; switched to a plain object\nexport const m = {};\n`,
		);
		const diags = await metaDiags();
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("before/after state");
	});

	it("flags `used to return ...`", async () => {
		writeFile(
			"src/f.ts",
			`// This used to return null on miss\nexport const g = () => undefined;\n`,
		);
		expect(await metaDiags()).toHaveLength(1);
	});

	it("flags `no longer needed`", async () => {
		writeFile(
			"src/g.ts",
			`// The shim is no longer needed after the upgrade\nexport const h = 1;\n`,
		);
		expect(await metaDiags()).toHaveLength(1);
	});

	it("flags `changed from X to Y`", async () => {
		writeFile("src/h.ts", `// Changed the default from 10 to 50 here\nexport const limit = 50;\n`);
		expect(await metaDiags()).toHaveLength(1);
	});
});

describe("meta-comment: negative fixtures (precision)", () => {
	it("does NOT flag a legitimate WHY comment", async () => {
		writeFile(
			"src/n1.ts",
			`// Round up because the API rejects fractional cents\nexport const cents = 1;\n`,
		);
		expect(await metaDiags()).toHaveLength(0);
	});

	it("does NOT flag TODO/FIXME comments", async () => {
		writeFile(
			"src/n2.ts",
			`// TODO: handle the previously-unsupported locale\nexport const l = 1;\n`,
		);
		expect(await metaDiags()).toHaveLength(0);
	});

	it("does NOT flag JSDoc with meaningful tags", async () => {
		writeFile(
			"src/n3.ts",
			`/**\n * @param n the count\n * @returns doubled value\n */\nexport const dbl = (n: number): number => n * 2;\n`,
		);
		expect(await metaDiags()).toHaveLength(0);
	});

	it("does NOT flag license headers", async () => {
		writeFile(
			"src/n4.ts",
			`// Copyright (c) 2026 Kenny\n// SPDX-License-Identifier: MIT\nexport const v = 1;\n`,
		);
		expect(await metaDiags()).toHaveLength(0);
	});

	it("does NOT flag a normal explanatory comment with no meta signal", async () => {
		writeFile(
			"src/n5.ts",
			`// Maps the raw provider payload to our internal shape\nexport const map = () => ({});\n`,
		);
		expect(await metaDiags()).toHaveLength(0);
	});

	it("does NOT flag `step 1 of 3` progress text or benign 'phase 2 bytes'", async () => {
		writeFile(
			"src/n6.ts",
			`// Reads phase 2 bytes from the framed message header\nexport const read = () => 0;\n`,
		);
		expect(await metaDiags()).toHaveLength(0);
	});

	it("does NOT flag UI wizard step references in normal prose", async () => {
		writeFile(
			"src/wizard.ts",
			[
				"// Step 2 polling + auto-sync when the user returns",
				"// Make sure step 3 has projects loaded",
				"// always start at step 1 — that submit call stamps onboardedAt",
				"export const x = 1;",
			].join("\n"),
		);
		expect(await metaDiags()).toHaveLength(0);
	});

	it("still flags a leading plan marker with a delimiter (`Step 1 -`)", async () => {
		writeFile("src/plan.ts", `// Step 1 - validate the incoming payload\nexport const y = 2;\n`);
		expect(await metaDiags()).toHaveLength(1);
	});
});
