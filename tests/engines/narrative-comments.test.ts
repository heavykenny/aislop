import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectNarrativeComments } from "../../src/engines/ai-slop/narrative-comments.js";
import { fixNarrativeComments } from "../../src/engines/ai-slop/narrative-comments-fix.js";
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
 * Detects side-effect expressions.
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

	it("preserves JSDoc that lacks a generic explanatory opener (real architecture notes)", async () => {
		writeFile(
			"middleware.ts",
			`/**
 * Middleware to track daily usage counts.
 * Limit enforcement is handled client-side via RevenueCat subscription checks.
 * Server-side enforcement requires a trusted subscription verification mechanism
 * (e.g. RevenueCat webhook writing subscription status to the profiles table).
 */
export async function checkUsageLimit() {}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
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
	 * Describes when to use mode.
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

	it("flags a long (5+ line) narration block with a slop signal inside a function body", async () => {
		writeFile(
			"long.ts",
			`function run() {
	// Represents the parsed configuration after merging defaults.
	// Holds the resolved values for each configuration key.
	// Tracks which keys came from the environment overrides.
	// Manages the lifecycle of the cached lookups.
	// Controls how often the resolved values refresh.
	return 1;
}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("long narrative block");
	});

	it("does NOT flag a long explanatory block with no narration signal", async () => {
		writeFile(
			"explain.ts",
			`function run() {
	// Werkzeug doesn't implement subdomain matching yet, so we fall back to
	// host matching here. Until that lands upstream we keep this shim, which
	// the routing layer relies on to resolve the correct endpoint. The order
	// of these checks also matters for the development server's reloader.
	// Downstream callers depend on the host being normalised first.
	return 1;
}
`,
		);
		expect(await detectNarrativeComments(ctx(tmpDir))).toHaveLength(0);
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

	it("flags 3+ line narration blocks (with a slop signal) inside function bodies", async () => {
		writeFile(
			"inside.ts",
			`export const run = () => {
	initState();
	// Represents the next-step list built from the counts.
	// Holds the elided count and the regression status.
	// Tracks each actionable sentence separately.
	buildSteps();
	return;
};
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].message).toMatch(/multi-line narrative prose/);
	});

	it("exempts 3-line blocks that contain a WHY marker (because / since / workaround / etc.)", async () => {
		writeFile(
			"why.ts",
			`export const run = () => {
	// Run this before the CORS middleware because credentialed origins
	// otherwise reject OPTIONS requests. Discovered in prod after session
	// cookies started arriving stripped — see issue #2143.
	register();
};
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("exempts Rust /// item-level doc comments", async () => {
		writeFile(
			"src/fs.rs",
			`/// Returns the canonical, absolute form of a path with all intermediate
/// components normalized and symbolic links resolved.
///
/// This is an async version of [\`std::fs::canonicalize\`].
///
/// # Platform-specific behavior
pub async fn canonicalize() {}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("exempts Rust //! module-level doc comments", async () => {
		writeFile(
			"src/lib.rs",
			`//! Types which are documented locally in the Tokio crate, but does not actually
//! live here.
//!
//! **Note** this module is only visible on docs.rs, you cannot use it directly
//! in your own code.

pub mod foo {}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("does not flag narrative comments inside vendored / third_party / examples dirs", async () => {
		writeFile(
			"vendor/legacy/foo.ts",
			`// This function does N things.
// First it parses input. Then it validates. Finally it writes.
export const run = () => 0;
`,
		);
		writeFile(
			"third_party/lib/bar.ts",
			`// Phase 1: setup
export const x = 1;
`,
		);
		writeFile(
			"src/blib2to3/grammar.py",
			`# Phase 1: tokenize
def tokenize(): pass
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("still flags plain // narrative blocks in .rs files (does not blanket-exempt Rust)", async () => {
		writeFile(
			"src/lib.rs",
			`// This function takes a request and returns a response.
// It does this by walking the routing table and matching the
// path. The match is then dispatched to the handler.
pub fn handle() {}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags.length).toBeGreaterThan(0);
	});

	it("exempts long Javadoc/PHPDoc description blocks above a declaration (no slop signal)", async () => {
		writeFile(
			"src/Box.java",
			`/**
 * A small data structure used throughout the runtime. Provides a
 * predictable lifecycle for inspection and update operations during
 * test runs and production paths alike. Subclasses may override the
 * default comparison strategy. Thread safety guarantees follow the
 * package conventions documented at the namespace level.
 */
public class Box {}
`,
		);
		writeFile(
			"src/Box.php",
			`<?php
/**
 * Provides a small surface for reading and updating a stored value.
 * Subclasses may extend the default comparison strategy. Documentation
 * for the lifecycle is published alongside the framework manual.
 * Implementations are expected to follow the package conventions for
 * locking, naming, and error propagation.
 */
class Box {}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("exempts Ruby YARD-tagged comment blocks", async () => {
		writeFile(
			"lib/auth.rb",
			`# Authenticates a user against the configured backend.
#
# @param username [String] the login
# @param password [String] the secret
# @return [Boolean] whether authentication succeeded
# @example
#   Auth.login("alice", "s3cret")
def login(username, password); end
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("exempts Ruby RDoc `##` marker blocks", async () => {
		writeFile(
			"lib/runner.rb",
			`##
# Runs a task by name with the given arguments and returns
# the captured output. Raises if the task is not registered.
# Used by the CLI front-end and the test harness.
def run_task(name, *args); end
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("exempts Ruby `#` doc blocks above a def that contain a WHY marker", async () => {
		writeFile(
			"lib/cache.rb",
			`# Lightweight cache root computation that reads the toplevel config.
# This method can be used before loading configuration files because
# the full ConfigStore is not available yet, otherwise we would have
# a chicken-and-egg problem during boot.
def self.root_dir_from_toplevel_config(cache_root_override = nil); end
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("exempts Go struct field doc comments (comment first word matches the field name)", async () => {
		writeFile(
			"key.go",
			`package x

type Key struct {
	// Text contains the actual characters received. This usually the same as
	// [Key.Code]. When [Key.Text] is non-empty, it indicates that the key
	// pressed represents printable character(s).
	Text string
}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("does NOT flag short imperative-verb step comments in Go function bodies", async () => {
		writeFile(
			"renderer.go",
			`package x

func render() {
	// Render top
	doStuff()

	// Render sides
	doMore()

	// Render bottom
	doEnd()
}
`,
		);
		const diags = await detectNarrativeComments(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});
});
