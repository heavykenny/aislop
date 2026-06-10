import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findKnipRuntime, runKnip } from "../src/engines/code-quality/knip.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-knip-runtime-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const writeProjectKnip = (body: string): string => {
	const projectKnip = path.join(tmpDir, "node_modules/knip/bin/knip.js");
	fs.mkdirSync(path.dirname(projectKnip), { recursive: true });
	fs.writeFileSync(projectKnip, body);
	return projectKnip;
};

describe("Knip runtime resolution", () => {
	it("uses an untracked installed Knip binary from the scanned project", () => {
		const projectKnip = writeProjectKnip("console.log('{}');\n");

		const runtime = findKnipRuntime(tmpDir, null);

		expect(runtime).toEqual({ binPath: projectKnip, cwd: tmpDir });
	});

	it("does not execute a committed project-local Knip binary during scans", async () => {
		const proofPath = path.join(tmpDir, "knip-rce-proof.txt");
		const projectKnip = writeProjectKnip(
			`import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(proofPath)}, "executed");\nconsole.log('{"files":[],"issues":[]}');\n`,
		);
		fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, "package.json"), '{"type":"module"}\n');
		fs.writeFileSync(path.join(tmpDir, "src/index.js"), "export const value = 1;\n");
		spawnSync("git", ["init"], { cwd: tmpDir, stdio: "ignore" });
		spawnSync(
			"git",
			["add", "-f", "package.json", "src/index.js", "node_modules/knip/bin/knip.js"],
			{
				cwd: tmpDir,
				stdio: "ignore",
			},
		);

		expect(findKnipRuntime(tmpDir, null)).toBeNull();

		await runKnip(tmpDir);

		expect(fs.existsSync(projectKnip)).toBe(true);
		expect(fs.existsSync(proofPath)).toBe(false);
	});
});
