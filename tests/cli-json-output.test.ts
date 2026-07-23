import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("cli json output", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-cli-json-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("flushes large failing JSON before exiting non-zero", () => {
		const sourceDir = path.join(tmpDir, "src");
		fs.mkdirSync(sourceDir, { recursive: true });

		for (let i = 0; i < 450; i++) {
			fs.writeFileSync(
				path.join(sourceDir, `secret-${i}.ts`),
				`export const api_key = "abcdefghijklmnopqrstuvwxyz${i}";\n`,
			);
		}

		const result = spawnSync(
			process.execPath,
			[path.resolve("dist/cli.js"), "scan", tmpDir, "--json"],
			{
				encoding: "utf8",
				env: {
					...process.env,
					AISLOP_NO_TELEMETRY: "1",
					DO_NOT_TRACK: "1",
					CI: "1",
					NO_COLOR: "1",
				},
				maxBuffer: 20 * 1024 * 1024,
			},
		);

		expect(result.status).toBe(1);
		expect(result.stdout.length).toBeGreaterThan(65_536);

		const parsed = JSON.parse(result.stdout) as {
			diagnostics: Array<{ rule: string }>;
			summary: { errors: number };
		};
		expect(parsed.summary.errors).toBeGreaterThan(0);
		expect(
			parsed.diagnostics.some((diagnostic) => diagnostic.rule === "security/hardcoded-secret"),
		).toBe(true);
		// Heavy test: scans 450 files through the full CLI subprocess. 15s was too tight under
		// parallel load (CI/local both flaked ~15.6s); match sibling heavy tests' headroom.
	}, 30_000);
});
