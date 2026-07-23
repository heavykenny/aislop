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
	languages: ["python"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-uv-workspace-admission-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectHallucinatedImports: uv workspace admission", () => {
	it("accepts an explicit root member without treating its name as a duplicate", async () => {
		writeFile(
			"pyproject.toml",
			`[project]
name = "root-dot"
version = "0.1.0"

[tool.uv.workspace]
members = [".", "packages/*"]
`,
		);
		writeFile(
			"packages/api/pyproject.toml",
			`[project]
name = "api-dot"
version = "0.1.0"
dependencies = ["fastapi"]
`,
		);
		writeFile("main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it.each([
		["missing version", ""],
		["invalid version", 'version = "not a version"\n'],
		["overflowing version", 'version = "18446744073709551616"\n'],
		["numeric requires-python", 'version = "0.1.0"\nrequires-python = 3\n'],
		["invalid requires-python", 'version = "0.1.0"\nrequires-python = "not a spec"\n'],
		["non-string dependency", 'version = "0.1.0"\ndependencies = [3]\n'],
	])("fails closed for %s metadata", async (_caseName, projectFields) => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeFile(
			"packages/shared/pyproject.toml",
			`[project]\nname = "shared"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile("packages/invalid/pyproject.toml", `[project]\nname = "invalid"\n${projectFields}`);
		writeFile("main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");
	});

	it.each([
		["dynamic", 'dynamic = ["version"]'],
		["static and dynamic", 'version = "0.1.0"\ndynamic = ["version"]'],
	])("accepts a member whose version is %s", async (_caseName, versionFields) => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeFile(
			"packages/api/pyproject.toml",
			`[project]
name = "api"
${versionFields}
dependencies = ["fastapi"]
`,
		);
		writeFile("main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it.each([
		"1!2.0rc1.post2.dev3+linux-x86_64",
		"1.0a.",
		"1.0post-",
		"1.0dev_",
		"1.0rc-",
		Array.from({ length: 130 }, () => "1").join("."),
	])("accepts PEP 440 member version %s", async (version) => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeFile(
			"packages/api/pyproject.toml",
			`[project]
name = "api"
version = "${version}"
dependencies = ["fastapi"]
`,
		);
		writeFile("main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("fails closed when a package workspace root omits its version", async () => {
		writeFile(
			"pyproject.toml",
			`[project]
name = "root"

[tool.uv.workspace]
members = ["packages/*"]
`,
		);
		writeFile(
			"packages/api/pyproject.toml",
			`[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile("main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");
	});

	it("fails closed when glob matching exceeds its global work budget", async () => {
		const hostile = Array.from(
			{ length: 127 },
			(_, index) => `packages/${"*a".repeat(50)}b${index}`,
		);
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]\nmembers = ${JSON.stringify(["packages/shared", ...hostile])}\n`,
		);
		writeFile(
			"packages/shared/pyproject.toml",
			`[project]\nname = "shared"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		for (let index = 0; index < 10; index += 1) {
			writeFile(`packages/${"a".repeat(240)}${index}/marker.txt`, "marker\n");
		}
		writeFile("main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");
	});
});
