import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRuntimeDependencies } from "../src/engines/security/runtime-dependencies.js";

let tmpDir: string;

const write = (relativePath: string, contents: string): void => {
	const target = path.join(tmpDir, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, contents, "utf-8");
};

const writeManifest = (relativePath: string, manifest: unknown): void =>
	write(relativePath, JSON.stringify(manifest));

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-runtime-deps-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("readRuntimeDependencies", () => {
	it("separates shipped dependencies from dev tooling in a single-package project", () => {
		writeManifest("package.json", {
			dependencies: { commander: "^12.0.0" },
			devDependencies: { mocha: "^11.0.0" },
		});

		const result = readRuntimeDependencies(tmpDir);

		expect(result?.runtimeDependencies.has("commander")).toBe(true);
		expect(result?.runtimeDependencies.has("mocha")).toBe(false);
	});

	it("counts optional and peer dependencies as shipped", () => {
		writeManifest("package.json", {
			optionalDependencies: { fsevents: "^2.0.0" },
			peerDependencies: { react: "^19.0.0" },
		});

		const result = readRuntimeDependencies(tmpDir);

		expect(result?.runtimeDependencies.has("fsevents")).toBe(true);
		expect(result?.runtimeDependencies.has("react")).toBe(true);
	});

	it("collects runtime dependencies from pnpm workspace members", () => {
		// A CVE reachable only through a member's production dependency is a shipped CVE.
		// Reading the root manifest alone would misreport it as dev-only.
		writeManifest("package.json", { devDependencies: { mocha: "^11.0.0" } });
		write("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n");
		writeManifest("packages/api/package.json", { dependencies: { hono: "^4.0.0" } });
		writeManifest("packages/web/package.json", { dependencies: { astro: "^7.0.0" } });

		const result = readRuntimeDependencies(tmpDir);

		expect(result?.runtimeDependencies.has("hono")).toBe(true);
		expect(result?.runtimeDependencies.has("astro")).toBe(true);
		expect(result?.runtimeDependencies.has("mocha")).toBe(false);
	});

	it("collects runtime dependencies from npm workspace members", () => {
		writeManifest("package.json", {
			workspaces: ["apps/*"],
			devDependencies: { vitest: "^4.0.0" },
		});
		writeManifest("apps/server/package.json", { dependencies: { express: "^5.0.0" } });

		const result = readRuntimeDependencies(tmpDir);

		expect(result?.runtimeDependencies.has("express")).toBe(true);
		expect(result?.runtimeDependencies.has("vitest")).toBe(false);
	});

	it("supports the object form of the npm workspaces field", () => {
		writeManifest("package.json", { workspaces: { packages: ["libs/*"] } });
		writeManifest("libs/core/package.json", { dependencies: { zod: "^4.0.0" } });

		const result = readRuntimeDependencies(tmpDir);

		expect(result?.runtimeDependencies.has("zod")).toBe(true);
	});

	it("ignores manifests vendored under node_modules", () => {
		writeManifest("package.json", { workspaces: ["packages/*"] });
		writeManifest("packages/api/package.json", { dependencies: { hono: "^4.0.0" } });
		writeManifest("node_modules/evil/package.json", { dependencies: { "not-ours": "^1.0.0" } });

		const result = readRuntimeDependencies(tmpDir);

		expect(result?.runtimeDependencies.has("hono")).toBe(true);
		expect(result?.runtimeDependencies.has("not-ours")).toBe(false);
	});

	it("returns undefined when there is no readable manifest, so severity is left alone", () => {
		expect(readRuntimeDependencies(tmpDir)).toBeUndefined();
	});

	it("returns undefined when the manifest is not valid JSON", () => {
		write("package.json", "{ not json");

		expect(readRuntimeDependencies(tmpDir)).toBeUndefined();
	});
});
