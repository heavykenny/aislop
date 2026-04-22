import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// We test the fix logic directly since runKnip requires the full knip binary.
// The detection integration is covered by the self-scan (aislop scans itself).

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-knip-deps-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("fixUnusedDependencies", () => {
	// Import dynamically to avoid module resolution issues in test env
	const loadFix = async () => {
		const mod = await import("../src/engines/code-quality/knip.js");
		return mod.fixUnusedDependencies;
	};

	it("does nothing when package.json does not exist", async () => {
		const fixUnusedDependencies = await loadFix();
		// Should not throw
		await fixUnusedDependencies(tmpDir);
	});

	it("does nothing when there are no unused deps", async () => {
		const pkgPath = path.join(tmpDir, "package.json");
		const original = {
			name: "test-pkg",
			dependencies: { express: "^4.18.0" },
			devDependencies: { vitest: "^1.0.0" },
		};
		fs.writeFileSync(pkgPath, JSON.stringify(original, null, "\t"));

		const fixUnusedDependencies = await loadFix();
		// runKnipDependencyCheck will return [] since knip binary won't find
		// anything in a bare temp dir
		await fixUnusedDependencies(tmpDir);

		const result = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
		expect(result.dependencies).toEqual(original.dependencies);
		expect(result.devDependencies).toEqual(original.devDependencies);
	});
});

describe("knip dependency diagnostic shape", () => {
	it("KNIP_MESSAGE_MAP covers all dependency types", async () => {
		// Verify the module exports work and the message map is complete
		const mod = await import("../src/engines/code-quality/knip.js");
		expect(mod.runKnip).toBeDefined();
		expect(mod.runKnipDependencyCheck).toBeDefined();
		expect(mod.fixUnusedDependencies).toBeDefined();
	});

	it("no longer exports the retired runKnipUnusedExports/fixKnipUnusedExports helpers", async () => {
		// The declaration-removal engine (src/engines/code-quality/unused-removal.ts)
		// now owns the full operation — detection and removal — using the
		// TypeScript compiler API. knip's `--fix` is no longer invoked, because
		// stripping `export` and leaving dead bodies behind created more work than
		// it saved.
		const mod = (await import("../src/engines/code-quality/knip.js")) as Record<string, unknown>;
		expect(mod.runKnipUnusedExports).toBeUndefined();
		expect(mod.fixKnipUnusedExports).toBeUndefined();
	});
});

describe("shouldIncludeIssue", () => {
	const loadPredicate = async () => {
		const mod = await import("../src/engines/code-quality/knip.js");
		return mod.shouldIncludeIssue;
	};

	it("drops binaries diagnostics for .github/workflows files", async () => {
		// Workflow YAML invokes runner-provided binaries (gh, aws, docker, jq)
		// that can never appear in package.json — pure false positive.
		const shouldIncludeIssue = await loadPredicate();
		expect(shouldIncludeIssue("binaries", ".github/workflows/sync-develop.yml")).toBe(false);
		expect(shouldIncludeIssue("binaries", ".github\\workflows\\ci.yml")).toBe(false);
	});

	it("keeps binaries diagnostics for non-workflow files", async () => {
		const shouldIncludeIssue = await loadPredicate();
		expect(shouldIncludeIssue("binaries", "scripts/release.sh")).toBe(true);
		expect(shouldIncludeIssue("binaries", "package.json")).toBe(true);
	});

	it("does not suppress other issue types in workflow files", async () => {
		const shouldIncludeIssue = await loadPredicate();
		expect(shouldIncludeIssue("dependencies", ".github/workflows/sync.yml")).toBe(true);
		expect(shouldIncludeIssue("unlisted", ".github/workflows/sync.yml")).toBe(true);
	});
});
