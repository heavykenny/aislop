import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	detectNarrativeComments,
	fixNarrativeComments,
} from "../../src/engines/ai-slop/narrative-comments.js";
import type { EngineContext } from "../../src/engines/types.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-narrative-"));
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
		security: { audit: true, auditTimeout: 25000 },
	},
});

const writeFile = (relativePath: string, content: string): string => {
	const full = path.join(tmpDir, relativePath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
	return full;
};

describe("narrative comments", () => {
	it("detects and removes a decorative separator", async () => {
		writeFile(
			"a.ts",
			`// ────────────────────────────────────────────
export const x = 1;
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(1);
		expect(diags[0].rule).toBe("ai-slop/narrative-comment");
		expect(diags[0].fixable).toBe(true);

		await fixNarrativeComments(ctx(tmpDir));
		const after = fs.readFileSync(path.join(tmpDir, "a.ts"), "utf-8");
		expect(after).toBe("export const x = 1;\n");
	});

	it("detects and removes phase headers", async () => {
		writeFile(
			"b.ts",
			`// Phase 1: Code changes (imports, lint, dependencies)
export const y = 2;
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(1);
		await fixNarrativeComments(ctx(tmpDir));
		expect(fs.readFileSync(path.join(tmpDir, "b.ts"), "utf-8")).toBe("export const y = 2;\n");
	});

	it("detects multi-line preamble blocks before declarations", async () => {
		writeFile(
			"c.ts",
			`// This function does N things in order.
// First it parses the input.
// Then it validates it.
// Finally it emits the output.
export const run = () => 0;
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(1);
		await fixNarrativeComments(ctx(tmpDir));
		expect(fs.readFileSync(path.join(tmpDir, "c.ts"), "utf-8")).toBe(
			"export const run = () => 0;\n",
		);
	});

	it("detects cross-reference commentary", async () => {
		writeFile(
			"d.ts",
			`// buildFixRender will then be called with includeHeader: false
const y = 1;
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(1);
	});

	it("preserves license headers", async () => {
		writeFile(
			"e.ts",
			`// Copyright (c) 2026 Kenny
// SPDX-License-Identifier: MIT
// All rights reserved.
export const v = 1;
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("preserves biome-ignore / eslint-disable comments", async () => {
		writeFile(
			"f.ts",
			`// biome-ignore lint/style/useConst: intentional
let z = 1;
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("detects and removes narrative headers in Python files", async () => {
		writeFile(
			"py/app.py",
			`# Phase 1: Build payload
def build_payload() -> int:
    return 1
`,
		);

		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags.some((d) => d.filePath === "py/app.py")).toBe(true);

		await fixNarrativeComments(ctx(tmpDir));
		const after = fs.readFileSync(path.join(tmpDir, "py/app.py"), "utf-8");
		expect(after).toBe(`def build_payload() -> int:
    return 1
`);
	});

	it("detects decorative separators in Ruby files", async () => {
		writeFile(
			"rb/service.rb",
			`# -------------------------
class Service
end
`,
		);

		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags.some((d) => d.filePath === "rb/service.rb")).toBe(true);
	});

	it("preserves noqa and rubocop disable directives in non-JS files", async () => {
		writeFile(
			"py/ignore.py",
			`# noqa: F401
import os
`,
		);
		writeFile(
			"rb/ignore.rb",
			`# rubocop:disable Layout/LineLength
class Service
end
`,
		);

		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags.filter((d) => d.filePath === "py/ignore.py")).toHaveLength(0);
		expect(diags.filter((d) => d.filePath === "rb/ignore.rb")).toHaveLength(0);
	});

	it("does NOT flag a short, substantive WHY comment", async () => {
		writeFile(
			"g.ts",
			`// wcwidth returns -1 for unmapped codepoints; treat as width 1.
const width = 1;
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("detects section headers with text between separator runs: `// ─── Title ───`", async () => {
		writeFile(
			"section.ts",
			`// ─── Classification ──────────────────────────────────────────────────────
export const classify = (): void => { return; };
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("decorative separator");
	});

	it("detects cross-reference phrases that span a line break within a block", async () => {
		writeFile(
			"xref.ts",
			`function run() {
\t// Emit the header up front so it appears above any progress output
\t// (including the verification spinner, if present). buildFixRender will
\t// then be called with includeHeader: false so the header isn't duplicated.
\treturn 1;
}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("cross-reference");
	});

	it("flags a JSDoc preamble block (3+ prose lines) before a declaration", async () => {
		writeFile(
			"jsdoc.ts",
			`/**
 * Heuristic side-effect detection.
 * Walks an expression subtree and flags
 * anything that could invoke code when the declaration initializes.
 */
export const hasSideEffect = (): boolean => false;
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("JSDoc preamble");
		await fixNarrativeComments(ctx(tmpDir));
		const after = fs.readFileSync(path.join(tmpDir, "jsdoc.ts"), "utf-8");
		expect(after).toBe("export const hasSideEffect = (): boolean => false;\n");
	});

	it("preserves JSDoc that contains meaningful tags (@param, @returns, @deprecated, @see, @example)", async () => {
		writeFile(
			"tagged.ts",
			`/**
 * Do something useful.
 * @param x the input
 * @returns the output
 */
export const f = (x: number): number => x + 1;
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("flags a single-line explanatory opener before a declaration: // Matches X, // Represents Y", async () => {
		writeFile(
			"explain.ts",
			`// Matches "// ─── Title ───" — separator runs flanking some text.
export const DECORATIVE_SECTION_HEADER = /^$/;
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("explanatory preamble");
		await fixNarrativeComments(ctx(tmpDir));
		const after = fs.readFileSync(path.join(tmpDir, "explain.ts"), "utf-8");
		expect(after).toBe("export const DECORATIVE_SECTION_HEADER = /^$/;\n");
	});

	it("does NOT flag a single-line explanatory opener that isn't before a declaration", async () => {
		writeFile(
			"inline.ts",
			`function run() {
\t// Matches the user input
\treturn 1;
}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("flags a JSDoc preamble block on an interface member (not only top-level declarations)", async () => {
		writeFile(
			"iface.ts",
			`export interface Options {
	/**
	 * Explains when to use mode.
	 * It does X in mode A and Y in mode B.
	 * Defaults to mode A.
	 */
	mode?: "a" | "b";
}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("JSDoc preamble");
	});

	it("flags a long (5+ line) prose block inside a function body", async () => {
		writeFile(
			"long.ts",
			`function run() {
	// First paragraph describing what we do.
	// There are several reasons for this shape.
	// It interacts with the caller's assumptions.
	// After the earlier refactor we kept the shape.
	// The downstream tests depend on this order.
	return 1;
}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("long narrative block");
	});

	it("does NOT flag a short 2-3 line WHY comment inside a function", async () => {
		writeFile(
			"short.ts",
			`function run() {
	// wcwidth returns -1 for unmapped codepoints;
	// treat those as width 1 to keep alignment stable.
	const width = 1;
	return width;
}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("removes preceding blank line to avoid orphan whitespace", async () => {
		writeFile(
			"h.ts",
			`export const first = 1;

// ──────────────────────
// Phase 2: Build
// ──────────────────────
export const second = 2;
`,
		);
		await fixNarrativeComments(ctx(tmpDir));
		const after = fs.readFileSync(path.join(tmpDir, "h.ts"), "utf-8");
		expect(after).toBe(`export const first = 1;

export const second = 2;
`);
	});

	it("preserves @swagger OpenAPI blocks", async () => {
		writeFile(
			"routes.js",
			`/**
 * @swagger
 * /users:
 *   get:
 *     summary: List users
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: ok
 */
router.get('/users', handler);
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("preserves @openapi blocks", async () => {
		writeFile(
			"openapi.js",
			`/**
 * @openapi
 * /health:
 *   get:
 *     summary: health check
 */
router.get('/health', handler);
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("preserves apidoc blocks (@api, @apiName, @apiGroup, @apiParam, @apiSuccess)", async () => {
		writeFile(
			"apidoc.js",
			`/**
 * @api {get} /user/:id Request User information
 * @apiName GetUser
 * @apiGroup User
 * @apiParam {Number} id Users unique ID.
 * @apiSuccess {String} firstname Firstname of the User.
 */
function getUser() {}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("preserves @route express-routes blocks", async () => {
		writeFile(
			"route.js",
			`/**
 * @route GET /api/auth/me
 * @group Auth
 * @security JWT
 * @returns {object} 200 user
 */
router.get('/api/auth/me', handler);
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});
});
