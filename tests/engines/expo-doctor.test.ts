import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runExpoDoctor } from "../../src/engines/lint/expo-doctor.js";
import type { EngineContext } from "../../src/engines/types.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-expo-doctor-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const makeContext = (rootDirectory: string): EngineContext => ({
	rootDirectory,
	languages: ["typescript"],
	frameworks: ["expo"],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: true, auditTimeout: 25000 },
	},
});

describe("runExpoDoctor", () => {
	it("skips silently (returns [] without running expo-doctor) when the project has no `expo` installed", async () => {
		// Write a package.json that DECLARES expo as a dep but doesn't have it
		// installed in node_modules. This mirrors the fresh-clone / missing-
		// node_modules case that previously produced a ConfigError.
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			JSON.stringify({ name: "test", dependencies: { expo: "^50.0.0" } }),
		);

		const diagnostics = await runExpoDoctor(makeContext(tmpDir));
		expect(diagnostics).toEqual([]);
	});

	it("skips silently for non-expo projects too (no false-positive ConfigError)", async () => {
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			JSON.stringify({ name: "test", dependencies: {} }),
		);

		const diagnostics = await runExpoDoctor(makeContext(tmpDir));
		expect(diagnostics).toEqual([]);
	});
});
