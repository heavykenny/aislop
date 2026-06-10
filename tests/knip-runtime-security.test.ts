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
	it("uses Aislop's bundled Knip binary when the scanned project declares Knip", () => {
		const projectKnip = writeProjectKnip("console.log('{}');\n");
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { knip: "^5.85.0" } }),
		);

		const runtime = findKnipRuntime(tmpDir, null);

		expect(runtime?.cwd).toBe(tmpDir);
		expect(runtime?.binPath).not.toBe(projectKnip);
		expect(runtime?.binPath.endsWith(path.join("node_modules", "knip", "bin", "knip.js"))).toBe(
			true,
		);
	});

	it("does not execute a committed project-local Knip binary during scans", async () => {
		const proofPath = path.join(tmpDir, "knip-rce-proof.txt");
		const projectKnip = writeProjectKnip(
			`import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(proofPath)}, "executed");\nconsole.log('{"files":[],"issues":[]}');\n`,
		);
		fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			JSON.stringify({ type: "module", devDependencies: { knip: "^5.85.0" } }),
		);
		fs.writeFileSync(path.join(tmpDir, "src/index.js"), "export const value = 1;\n");

		expect(findKnipRuntime(tmpDir, null)?.binPath).not.toBe(projectKnip);

		await runKnip(tmpDir);

		expect(fs.existsSync(projectKnip)).toBe(true);
		expect(fs.existsSync(proofPath)).toBe(false);
	});
});
