import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-unscoreable-"));
	execFileSync("git", ["init"], { cwd: tmpDir, stdio: "ignore" });
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("unscoreable scan output", () => {
	it("renders findings alongside the coverage notice when the score is withheld", () => {
		for (let i = 0; i < 15; i++) {
			fs.writeFileSync(path.join(tmpDir, `f${i}.c`), "int main(){return 0;}\n");
		}
		fs.writeFileSync(
			path.join(tmpDir, "app.ts"),
			'import { readFileSync } from "node:fs";\nexport const x = 1;\n',
		);

		const out = execFileSync("node", [CLI, "scan", "."], { cwd: tmpDir, encoding: "utf-8" });
		expect(out).toContain("Score withheld");
		expect(out).toContain("never used");
	});
});
