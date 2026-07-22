import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanCommand } from "../src/commands/scan.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { AislopConfig } from "../src/config/index.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const buildConfig = (include: string[] = []): AislopConfig => ({
	...DEFAULT_CONFIG,
	include,
	engines: {
		format: false,
		lint: false,
		"code-quality": false,
		"ai-slop": true,
		architecture: false,
		security: false,
	},
	security: { ...DEFAULT_CONFIG.security, audit: false },
	ci: { ...DEFAULT_CONFIG.ci, failBelow: 100 },
	telemetry: { enabled: false },
});

const runJsonScan = (config: AislopConfig) =>
	scanCommand(tmpDir, config, {
		changes: false,
		staged: false,
		verbose: false,
		json: true,
		showHeader: false,
		printBrand: false,
	});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-test-scope-"));
	vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("test scan scope", () => {
	it("does not crash when a test-only project has a finding", async () => {
		writeFile("tests/test_pipeline.py", "def test_pipeline():\n    assert True\n");

		await expect(runJsonScan(buildConfig())).resolves.toMatchObject({
			findingCount: 1,
			warningCount: 1,
		});
	});

	it("keeps test findings inside an explicit include scope", async () => {
		writeFile("src/app.ts", "export const app = true;\n");
		writeFile("tests/outside.test.ts", "expect(true).toBe(true);\n");

		await expect(runJsonScan(buildConfig(["src"]))).resolves.toMatchObject({
			findingCount: 0,
			exitCode: 0,
		});
		await expect(runJsonScan(buildConfig())).resolves.toMatchObject({
			findingCount: 1,
			exitCode: 1,
		});
	});

	it("uses production and test files when scoring test findings", async () => {
		writeFile("src/app.ts", "export const app = true;\n");
		writeFile("tests/value.test.ts", "expect(true).toBe(true);\n");
		const smallProject = await runJsonScan(buildConfig());

		for (let index = 0; index < 100; index++) {
			writeFile(`tests/clean-${index}.test.ts`, "expect(run()).toBe(true);\n");
		}
		const largeProject = await runJsonScan(buildConfig());

		expect(largeProject.score).toBeGreaterThan(smallProject.score);
	});

	it("does not use excluded declarations as import evidence", async () => {
		writeFile("package.json", JSON.stringify({ name: "project", dependencies: {} }));
		writeFile("src/ignored.d.ts", 'declare module "ghost:ignored";\n');
		writeFile("src/app.ts", 'import value from "ghost:ignored";\nvalue();\n');

		await expect(
			runJsonScan({ ...buildConfig(), exclude: ["src/ignored.d.ts"] }),
		).resolves.toMatchObject({ findingCount: 1 });
	});
});
