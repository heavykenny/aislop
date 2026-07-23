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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-uv-workspace-symlink-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const writeWorkspace = (): void => {
	writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
	writeFile(
		"packages/api/pyproject.toml",
		`[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
	);
	writeFile("packages/api/src/api/__init__.py", "");
	writeFile("src/main.py", "import fastapi\n");
};

describe("detectHallucinatedImports: uv workspace symlinks", () => {
	it("fails the workspace union when a member glob encounters a directory symlink", async () => {
		const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-uv-member-link-"));
		try {
			writeWorkspace();
			fs.symlinkSync(
				externalDirectory,
				path.join(tmpDir, "packages", "linked"),
				process.platform === "win32" ? "junction" : "dir",
			);

			const diagnostics = await detectHallucinatedImports(buildContext());

			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0].message).toContain("fastapi");
		} finally {
			fs.rmSync(externalDirectory, { recursive: true, force: true });
		}
	});

	it("keeps skipped directory symlinks out of workspace traversal", async () => {
		const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-uv-skipped-link-"));
		try {
			writeWorkspace();
			fs.symlinkSync(
				externalDirectory,
				path.join(tmpDir, "packages", "api", "node_modules"),
				process.platform === "win32" ? "junction" : "dir",
			);

			const diagnostics = await detectHallucinatedImports(buildContext());

			expect(diagnostics).toEqual([]);
		} finally {
			fs.rmSync(externalDirectory, { recursive: true, force: true });
		}
	});

	it("ignores an unrelated directory symlink that no member pattern can reach", async () => {
		const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-uv-unrelated-link-"));
		try {
			writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/a*"]\n`);
			writeFile(
				"packages/api/pyproject.toml",
				`[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
			);
			fs.symlinkSync(
				externalDirectory,
				path.join(tmpDir, "packages", "zzz"),
				process.platform === "win32" ? "junction" : "dir",
			);
			writeFile("src/main.py", "import fastapi\n");

			const diagnostics = await detectHallucinatedImports(buildContext());

			expect(diagnostics).toEqual([]);
		} finally {
			fs.rmSync(externalDirectory, { recursive: true, force: true });
		}
	});

	it("ignores an excluded directory symlink without following its target", async () => {
		const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-uv-excluded-link-"));
		try {
			writeWorkspace();
			writeFile(
				"pyproject.toml",
				`[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = ["packages/linked"]\n`,
			);
			fs.symlinkSync(
				externalDirectory,
				path.join(tmpDir, "packages", "linked"),
				process.platform === "win32" ? "junction" : "dir",
			);

			const diagnostics = await detectHallucinatedImports(buildContext());

			expect(diagnostics).toEqual([]);
		} finally {
			fs.rmSync(externalDirectory, { recursive: true, force: true });
		}
	});

	it("validates a skipped directory name when the member glob matches it", async () => {
		writeWorkspace();
		writeFile("packages/node_modules/marker.txt", "marker\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");
	});

	it("fails closed when a member glob can reach below a skipped directory", async () => {
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]\nmembers = ["packages/shared", "packages/**/member"]\n`,
		);
		writeFile(
			"packages/shared/pyproject.toml",
			`[project]\nname = "shared"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile("packages/node_modules/member/pyproject.toml", "not valid toml = [\n");
		writeFile("src/main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");
	});

	it("ignores an unreachable skipped directory at the traversal depth limit", async () => {
		const deepDirectory = ["packages", "deep", ...Array.from({ length: 30 }, (_, i) => `d${i}`)];
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]\nmembers = ["packages/shared", "packages/deep/*/member"]\n`,
		);
		writeFile(
			"packages/shared/pyproject.toml",
			`[project]\nname = "shared"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile(`${deepDirectory.join("/")}/node_modules/marker.txt`, "marker\n");
		writeFile("src/main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not traverse ordinary descendants beyond a terminal member glob", async () => {
		const deepDirectory = ["packages", "shared", ...Array.from({ length: 31 }, (_, i) => `d${i}`)];
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeFile(
			"packages/shared/pyproject.toml",
			`[project]\nname = "shared"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile(`${deepDirectory.join("/")}/marker.txt`, "marker\n");
		writeFile("src/main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});
});
