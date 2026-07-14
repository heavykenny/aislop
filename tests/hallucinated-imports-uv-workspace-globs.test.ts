import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectHallucinatedImports } from "../src/engines/ai-slop/hallucinated-imports.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const writeFile = (relative: string, content: string | Uint8Array): void => {
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

const writeSharedMember = (): void => {
	writeFile(
		"packages/shared/pyproject.toml",
		`[project]\nname = "shared"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
	);
	writeFile("main.py", "import fastapi\n");
};

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-uv-workspace-globs-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectHallucinatedImports: uv workspace glob validation", () => {
	it("rejects embedded recursive wildcards that uv cannot parse", async () => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/foo**bar"]\n`);
		writeFile(
			"packages/foobar/pyproject.toml",
			`[project]\nname = "foobar"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile("main.py", "import fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");
	});

	it.runIf(process.platform !== "win32")(
		"treats backslashes in POSIX exclude patterns as literal characters",
		async () => {
			writeFile(
				"pyproject.toml",
				`[tool.uv.workspace]\nmembers = ["*"]\nexclude = ['packages\\*']\n`,
			);
			writeFile(
				"packages\\foo/pyproject.toml",
				`[project]\nname = "member"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
			);
			writeFile("main.py", "import fastapi\n");

			const diagnostics = await detectHallucinatedImports(buildContext());

			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0].message).toContain("fastapi");
		},
	);

	it("validates member paths containing the former separator sentinel", async () => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeSharedMember();
		writeFile("packages/\u{e000}/marker.txt", "marker\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");
	});

	it("accepts descending character ranges that match no member", async () => {
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]\nmembers = ["packages/shared", "packages/[2-1]"]\n`,
		);
		writeSharedMember();

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("matches separators inside uv exclude character classes", async () => {
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = ["packages[/]excluded"]\n`,
		);
		writeSharedMember();
		writeFile("packages/excluded/marker.txt", "marker\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it.runIf(process.platform !== "win32")(
		"validates wildcard members whose names contain newlines",
		async () => {
			writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
			writeSharedMember();
			writeFile("packages/bad\nmember/marker.txt", "marker\n");

			const diagnostics = await detectHallucinatedImports(buildContext());

			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0].message).toContain("fastapi");
		},
	);

	it("bounds adversarial wildcard matching", async () => {
		const hostilePattern = `packages/${"*a".repeat(16)}b`;
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]\nmembers = ["packages/shared", "${hostilePattern}"]\n`,
		);
		writeSharedMember();
		writeFile(`packages/${"a".repeat(200)}/marker.txt`, "marker\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it.each(["bad name", " bad"])("rejects member name %j that uv cannot normalize", async (name) => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeSharedMember();
		writeFile("packages/invalid/pyproject.toml", `[project]\nname = "${name}"\n`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");
	});

	it("rejects member manifests containing invalid UTF-8", async () => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeSharedMember();
		writeFile(
			"packages/invalid/pyproject.toml",
			Buffer.concat([Buffer.from(`[project]\nname = "invalid"\n# `), Buffer.from([0xff])]),
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");
	});
});
