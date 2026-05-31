import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixUnusedImports } from "../src/engines/ai-slop/unused-imports-fix.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const makeContext = (files: string[]): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["python"],
	frameworks: ["none"],
	files,
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 4, maxParams: 6 },
		security: { audit: true, auditTimeout: 25000 },
	},
});

const write = (filename: string, content: string): string => {
	const filePath = path.join(tmpDir, filename);
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
};

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-unused-py-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("fixUnusedImports — Python comma imports", () => {
	it("trims only the unused module, preserving the rest of the line", async () => {
		const file = write("m.py", "import os, sys\n\nprint(sys.path)\n");
		await fixUnusedImports(makeContext([file]));
		expect(fs.readFileSync(file, "utf-8")).toBe("import sys\n\nprint(sys.path)\n");
	});

	it("removes the whole line when every module on it is unused", async () => {
		const file = write("m.py", "import os, sys\n\nx = 1\nprint(x)\n");
		await fixUnusedImports(makeContext([file]));
		expect(fs.readFileSync(file, "utf-8")).toBe("x = 1\nprint(x)\n");
	});

	it("leaves the line untouched when every module is used", async () => {
		const file = write("m.py", "import os, sys\n\nprint(os.getcwd(), sys.path)\n");
		await fixUnusedImports(makeContext([file]));
		expect(fs.readFileSync(file, "utf-8")).toBe("import os, sys\n\nprint(os.getcwd(), sys.path)\n");
	});

	it("respects an alias as the bound name", async () => {
		const file = write("m.py", "import os, numpy as np\n\nprint(np.array([1]))\n");
		await fixUnusedImports(makeContext([file]));
		expect(fs.readFileSync(file, "utf-8")).toBe("import numpy as np\n\nprint(np.array([1]))\n");
	});
});
