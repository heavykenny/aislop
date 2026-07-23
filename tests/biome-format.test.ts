import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBiomeFormat } from "../src/engines/format/biome.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-biome-format-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Biome formatting diagnostics", () => {
	it("emits POSIX-relative file paths", async () => {
		const sourcePath = path.join(tmpDir, "src", "unformatted.ts");
		fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, "biome.json"), '{"formatter":{"enabled":true}}\n');
		fs.writeFileSync(sourcePath, "export const value={answer:42};\n");

		const context: EngineContext = {
			rootDirectory: tmpDir,
			languages: ["typescript"],
			frameworks: [],
			files: [sourcePath],
			installedTools: {},
			config: {
				quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
				security: { audit: false, auditTimeout: 0 },
				lint: { typecheck: false },
			},
		};

		const diagnostics = await runBiomeFormat(context);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].filePath).toBe("src/unformatted.ts");
	});
});
