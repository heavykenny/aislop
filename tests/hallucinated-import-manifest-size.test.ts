import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectHallucinatedImports } from "../src/engines/ai-slop/hallucinated-imports.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const buildContext = (): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["typescript"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-hallucinated-manifest-size-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectHallucinatedImports - oversized manifests", () => {
	it("still scans JavaScript when the root package manifest is too large to trust", async () => {
		const oversizedPackage = JSON.stringify({
			name: "oversized-root",
			dependencies: {},
			filler: "x".repeat(1_048_576),
		});
		expect(Buffer.byteLength(oversizedPackage)).toBeGreaterThan(1_048_576);
		writeFile("package.json", oversizedPackage);
		writeFile("src/index.ts", 'import value from "totally-fake-package";\nvalue;\n');

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([
			expect.objectContaining({
				filePath: "src/index.ts",
				message: expect.stringContaining("totally-fake-package"),
			}),
		]);
	});

	it.runIf(process.platform !== "win32")(
		"still scans JavaScript when the root package manifest is an unsafe symlink",
		async () => {
			const outsideDir = fs.mkdtempSync(
				path.join(os.tmpdir(), "aislop-hallucinated-manifest-link-"),
			);
			try {
				fs.writeFileSync(
					path.join(outsideDir, "package.json"),
					JSON.stringify({ dependencies: { "totally-fake-package": "1.0.0" } }),
				);
				fs.symlinkSync(path.join(outsideDir, "package.json"), path.join(tmpDir, "package.json"));
				writeFile("src/index.ts", 'import value from "totally-fake-package";\nvalue;\n');

				const diagnostics = await detectHallucinatedImports(buildContext());

				expect(diagnostics).toEqual([
					expect.objectContaining({
						filePath: "src/index.ts",
						message: expect.stringContaining("totally-fake-package"),
					}),
				]);
			} finally {
				fs.rmSync(outsideDir, { recursive: true, force: true });
			}
		},
	);
});
