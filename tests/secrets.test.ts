import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanSecrets } from "../src/engines/security/secrets.js";
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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-secrets-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("scanSecrets", () => {
	it("flags a hardcoded password in real code", async () => {
		writeFile("src/config.ts", `export const config = { password: "s3cr3tValue99" }\n`);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].rule).toBe("security/hardcoded-secret");
		expect(diagnostics[0].severity).toBe("error");
	});

	it("does not flag the same secret inside a JSDoc @example", async () => {
		writeFile(
			"src/usage.ts",
			`/**\n * @example\n * const config = { password: "s3cr3tValue99" }\n */\nexport const handler = () => null\n`,
		);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toEqual([]);
	});
});
