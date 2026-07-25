import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectHallucinatedImports } from "../src/engines/ai-slop/hallucinated-imports.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const buildContext = (rootDirectory = tmpDir): EngineContext => ({
	rootDirectory,
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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-uv-workspace-hardening-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectHallucinatedImports: uv workspace hardening", () => {
	it("does not activate a workspace whose root is unmanaged", async () => {
		writeFile(
			"pyproject.toml",
			`[project]
name = "workspace-root"
version = "0.1.0"
dependencies = []

[tool.uv]
managed = false

[tool.uv.workspace]
members = ["packages/*"]
`,
		);
		writeFile(
			"packages/api/pyproject.toml",
			`[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile("packages/api/src/api/__init__.py", "");
		writeFile("src/main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");
	});

	it("parses quoted TOML keys when omitting an unmanaged member", async () => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeFile(
			"packages/api/pyproject.toml",
			`[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile("packages/api/src/api/__init__.py", "");
		writeFile(
			"packages/unmanaged/pyproject.toml",
			`[project]
name = "unmanaged"
version = "0.1.0"
dependencies = ["boto3"]

[tool . "uv"]
"managed" = false
`,
		);
		writeFile("packages/unmanaged/src/unmanaged/app.py", "import boto3\nimport fastapi\n");
		writeFile("src/main.py", "import boto3\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(2);
		expect(
			diagnostics.some(
				(diagnostic) =>
				diagnostic.filePath === "src/main.py" &&
					diagnostic.message.includes("boto3"),
			),
		).toBe(true);
		expect(
			diagnostics.some(
				(diagnostic) =>
					diagnostic.filePath.includes("unmanaged") && diagnostic.message.includes("fastapi"),
			),
		).toBe(true);
	});

	it("fails the workspace union when a matched directory has no pyproject", async () => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeFile(
			"packages/api/pyproject.toml",
			`[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile("packages/api/src/api/__init__.py", "");
		writeFile("packages/broken/app.py", "import fastapi\n");
		writeFile("src/main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.every((diagnostic) => diagnostic.message.includes("fastapi"))).toBe(true);
	});

	it.each([
		["missing project", `[tool.demo]\nenabled = true\n`],
		["malformed TOML", `[project\nname = "broken"\n`],
		[
			"nested workspace",
			`[project]
name = "broken"
version = "0.1.0"
dependencies = ["boto3"]

[tool.uv.workspace]
members = []
`,
		],
	])("fails the workspace union for a %s member manifest", async (_caseName, manifest) => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeFile(
			"packages/api/pyproject.toml",
			`[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile("packages/api/src/api/__init__.py", "");
		writeFile("packages/broken/pyproject.toml", manifest);
		writeFile("packages/broken/app.py", "import fastapi\n");
		writeFile("src/main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.every((diagnostic) => diagnostic.message.includes("fastapi"))).toBe(true);
	});

	it("fails the workspace union for duplicate normalized project names", async () => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeFile(
			"packages/one/pyproject.toml",
			`[project]\nname = "shared_pkg"\nversion = "0.1.0"\ndependencies = ["one-dep"]\n`,
		);
		writeFile("packages/one/src/shared_pkg/__init__.py", "");
		writeFile(
			"packages/two/pyproject.toml",
			`[project]\nname = "shared-pkg"\nversion = "0.1.0"\ndependencies = ["two-dep"]\n`,
		);
		writeFile("packages/two/src/shared_pkg/__init__.py", "");
		writeFile("src/main.py", "import one_dep\nimport two_dep\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.some((diagnostic) => diagnostic.message.includes("one_dep"))).toBe(true);
		expect(diagnostics.some((diagnostic) => diagnostic.message.includes("two_dep"))).toBe(true);
	});

	it("preserves native backslash semantics in member patterns", async () => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ['packages\\*']\n`);
		writeFile(
			"packages/api/pyproject.toml",
			`[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile("packages/api/src/api/__init__.py", "");
		writeFile("src/main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(path.sep === "\\" ? 0 : 1);
		if (diagnostics[0]) expect(diagnostics[0].message).toContain("fastapi");
	});

	it("fails the workspace union when the depth limit would truncate traversal", async () => {
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]\nmembers = ["packages/shared", "packages/deep/**/member"]\n`,
		);
		writeFile(
			"packages/shared/pyproject.toml",
			`[project]\nname = "shared"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile("packages/shared/src/shared/__init__.py", "");
		const deepParent = ["packages", "deep"];
		for (let index = 0; index < 30; index += 1) deepParent.push(`level-${index}`);
		writeFile(path.join(...deepParent, "member", "pyproject.toml"), `[project\nname = "broken"\n`);
		writeFile("src/main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");
	});

	it("fails the workspace union when a traversed directory cannot be enumerated", async () => {
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]\nmembers = ["packages/*", "packages/**/member"]\n`,
		);
		writeFile(
			"packages/api/pyproject.toml",
			`[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile("packages/api/src/api/__init__.py", "");
		writeFile("src/main.py", "import fastapi\n");
		const apiDirectory = path.join(tmpDir, "packages", "api");
		const openDirectory = fs.opendirSync;
		const openDirectorySpy = vi
			.spyOn(fs, "opendirSync")
			.mockImplementation((directory, options) => {
				if (path.resolve(directory.toString()) === apiDirectory) throw new Error("unreadable");
				return openDirectory(directory, options);
			});

		try {
			const diagnostics = await detectHallucinatedImports(buildContext());

			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0].message).toContain("fastapi");
		} finally {
			openDirectorySpy.mockRestore();
		}
	});

	it("keeps an unmanaged project's own dependencies when scanning its source subtree", async () => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeFile(
			"packages/unmanaged/pyproject.toml",
			`[project]
name = "unmanaged"
version = "0.1.0"
dependencies = ["boto3"]

[tool.uv]
managed = false
`,
		);
		writeFile("packages/unmanaged/src/unmanaged/app.py", "import boto3\n");
		const sourceDirectory = path.join(tmpDir, "packages", "unmanaged", "src");

		const diagnostics = await detectHallucinatedImports(buildContext(sourceDirectory));

		expect(diagnostics).toEqual([]);
	});

	it("keeps a deeply nested unmanaged project independently scoped in a root scan", async () => {
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]
members = ["packages/shared", "packages/**/unmanaged"]
`,
		);
		writeFile(
			"packages/shared/pyproject.toml",
			`[project]\nname = "shared"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile("packages/shared/src/shared/__init__.py", "");
		const unmanagedDirectory = path.join("packages", "one", "two", "three", "four", "unmanaged");
		writeFile(
			path.join(unmanagedDirectory, "pyproject.toml"),
			`[project]
name = "unmanaged"
version = "0.1.0"
dependencies = ["boto3"]

[tool.uv]
managed = false
`,
		);
		writeFile(path.join(unmanagedDirectory, "src", "app.py"), "import boto3\nimport fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");
	});
});
