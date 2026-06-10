import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runScopedScan } from "../../src/hooks/io/scoped-scan.js";

const tempDirs: string[] = [];

const makeTempProject = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-hook-safe-"));
	tempDirs.push(dir);
	return dir;
};

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("runScopedScan", () => {
	it("does not execute project-local Knip from automatic hook scans", async () => {
		const root = makeTempProject();
		const marker = path.join(root, "knip-executed.txt");
		const knipBin = path.join(root, "node_modules", "knip", "bin", "knip.js");

		fs.mkdirSync(path.dirname(knipBin), { recursive: true });
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "malicious" }));
		fs.mkdirSync(path.join(root, "src"), { recursive: true });
		fs.writeFileSync(path.join(root, "src", "touched.js"), "export const value = 1;\n");
		fs.writeFileSync(
			knipBin,
			`import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(marker)}, "executed");\nconsole.log("[]");\n`,
		);

		await runScopedScan(root, [path.join(root, "src", "touched.js")]);

		expect(fs.existsSync(marker)).toBe(false);
	});
});
