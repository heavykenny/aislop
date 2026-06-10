import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codeQualityEngine } from "../../src/engines/code-quality/index.js";
import type { EngineContext } from "../../src/engines/types.js";

let tmpDir: string;

const writeFile = (relativePath: string, content: string): string => {
	const filePath = path.join(tmpDir, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
};

const writeFakeKnip = (markerPath: string): void => {
	writeFile(
		path.join("node_modules", "knip", "bin", "knip.js"),
		`import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(markerPath)}, "executed");\nprocess.stdout.write(JSON.stringify({ files: [], issues: [] }));\n`,
	);
};

const makeContext = (file: string, allowProjectLocalTools?: boolean): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["javascript"],
	frameworks: ["none"],
	files: [file],
	installedTools: {},
	config: {
		quality: {
			maxFunctionLoc: 80,
			maxFileLoc: 400,
			maxNesting: 5,
			maxParams: 6,
		},
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false, expoDoctor: false },
		allowProjectLocalTools,
	},
});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-code-quality-tools-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("codeQualityEngine project-local tools", () => {
	it("does not execute project-local Knip when project-local tools are disabled", async () => {
		fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "untrusted" }));
		const file = writeFile("src/app.js", "export const ok = true;\n");
		const markerPath = path.join(tmpDir, "knip-executed");
		writeFakeKnip(markerPath);

		await codeQualityEngine.run(makeContext(file, false));

		expect(fs.existsSync(markerPath)).toBe(false);
	});

	it("uses the trusted Knip runtime when project-local tools are allowed by default", async () => {
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			JSON.stringify({ name: "trusted", devDependencies: { knip: "^5.85.0" } }),
		);
		const file = writeFile("src/app.js", "export const ok = true;\n");
		const markerPath = path.join(tmpDir, "knip-executed");
		writeFakeKnip(markerPath);

		await codeQualityEngine.run(makeContext(file));

		expect(fs.existsSync(markerPath)).toBe(false);
	});
});
