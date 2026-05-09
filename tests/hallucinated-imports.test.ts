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
	languages: ["typescript", "javascript", "python"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

const writePkgJson = (deps: Record<string, string> = {}, devDeps: Record<string, string> = {}): void => {
	writeFile(
		"package.json",
		JSON.stringify({ name: "test", version: "1.0.0", dependencies: deps, devDependencies: devDeps }),
	);
};

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-hallucinated-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectHallucinatedImports — JS/TS", () => {
	it("returns no diagnostics when imports are declared, relative, or built-in", async () => {
		writePkgJson({ lodash: "^4.0.0", "@scope/pkg": "^1.0.0" }, { vitest: "^1.0.0" });
		writeFile(
			"src/index.ts",
			`import _ from "lodash"
import { something } from "@scope/pkg"
import { describe } from "vitest"
import { useFoo } from "./foo"
import fs from "node:fs"
import path from "path"
import { get } from "lodash/get"
import sub from "@scope/pkg/sub"
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("flags an undeclared package import as ai-slop/hallucinated-import", async () => {
		writePkgJson({ lodash: "^4.0.0" });
		writeFile(
			"src/index.ts",
			`import _ from "lodash"
import { magic } from "totally-made-up-package"
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		const [diag] = diagnostics;
		expect(diag.engine).toBe("ai-slop");
		expect(diag.rule).toBe("ai-slop/hallucinated-import");
		expect(diag.severity).toBe("error");
		expect(diag.fixable).toBe(false);
		expect(diag.filePath).toBe(path.join("src", "index.ts"));
		expect(diag.line).toBe(2);
		expect(diag.message).toContain("totally-made-up-package");
	});

	it("does not false-positive on @types/X when X is in deps", async () => {
		writePkgJson({ react: "^18.0.0" }, { "@types/react": "^18.0.0" });
		writeFile(
			"src/types.ts",
			`import type { ReactNode } from "react"
export type Node = ReactNode
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not false-positive on `import ... from \"x\"` written inside a string literal in source (e.g. help text)", async () => {
		writePkgJson({ lodash: "^4.0.0" });
		// Mirrors the FP found when scanning aislop on itself — the duplicate-import rule's
		// help string contained the literal text `import { A, type B } from "x"` as an
		// example, and the old un-anchored regex matched it as a real import.
		writeFile(
			"src/help-text.ts",
			[
				`import { format } from "lodash"`,
				`export const HELP = 'Two imports from the same module split readers\\' attention. Merge them: \`import { A, type B } from "x"\` or \`import type { A, B } from "x"\`.'`,
				`export { format }`,
				``,
			].join("\n"),
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not false-positive on import-shaped substrings inside template literals or error messages", async () => {
		writePkgJson({ lodash: "^4.0.0" });
		writeFile(
			"src/messages.ts",
			`import _ from "lodash"
const msg = \`Forbidden import '\${name}' (rule: \${rule})\`
const example = "import('foo bar')" // string with whitespace; not real
const tpl = \`import("\${dynamicPath}")\` // template-literal placeholder
export { msg, example, tpl }
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("flags require() calls and dynamic imports too", async () => {
		writePkgJson({ lodash: "^4.0.0" });
		writeFile(
			"src/dynamic.ts",
			`const m = require("ghost-package-cjs")
const m2 = await import("ghost-package-esm")
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());
		const ruleIds = diagnostics.map((d) => d.rule);
		const messages = diagnostics.map((d) => d.message);

		expect(ruleIds).toEqual([
			"ai-slop/hallucinated-import",
			"ai-slop/hallucinated-import",
		]);
		expect(messages.some((m) => m.includes("ghost-package-cjs"))).toBe(true);
		expect(messages.some((m) => m.includes("ghost-package-esm"))).toBe(true);
	});
});

describe("detectHallucinatedImports — Python", () => {
	it("returns no diagnostics for stdlib + declared deps + relative imports", async () => {
		writeFile("requirements.txt", "requests==2.31.0\nnumpy>=1.20\n");
		writeFile(
			"src/main.py",
			`import os
import sys
from pathlib import Path
import requests
import numpy as np
from .helpers import shared
from . import sibling
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("flags an undeclared, non-stdlib python import", async () => {
		writeFile("requirements.txt", "requests==2.31.0\n");
		writeFile(
			"src/main.py",
			`import requests
import made_up_lib
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		const [diag] = diagnostics;
		expect(diag.rule).toBe("ai-slop/hallucinated-import");
		expect(diag.severity).toBe("error");
		expect(diag.message).toContain("made_up_lib");
		expect(diag.line).toBe(2);
	});

	it("resolves common import-name → pip-name divergences (PIL, yaml, sklearn, etc.)", async () => {
		writeFile("requirements.txt", "pyyaml==6.0\npillow==10.0\nscikit-learn==1.3\n");
		writeFile(
			"src/main.py",
			`import yaml
from PIL import Image
import sklearn.cluster as cluster
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("reads pyproject.toml [project] dependencies and poetry deps", async () => {
		writeFile(
			"pyproject.toml",
			`[project]
name = "demo"
version = "0.1.0"
dependencies = [
  "requests>=2.0",
  "fastapi==0.100.0",
]

[tool.poetry.dependencies]
python = "^3.11"
sqlalchemy = "^2.0"
`,
		);
		writeFile(
			"src/api.py",
			`import requests
from fastapi import FastAPI
import sqlalchemy
import made_up_orm
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("made_up_orm");
	});
});

describe("detectHallucinatedImports — guards", () => {
	it("returns [] when there is no manifest at all (can't tell what's declared)", async () => {
		writeFile("src/index.ts", `import { anything } from "any-package"`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("only flags JS imports when only package.json exists; leaves Python alone", async () => {
		writePkgJson({ lodash: "^4.0.0" });
		// No requirements.txt / pyproject.toml
		writeFile("src/index.ts", `import { x } from "made-up-js"`);
		writeFile("src/main.py", `import made_up_py`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].filePath).toBe(path.join("src", "index.ts"));
		expect(diagnostics[0].message).toContain("made-up-js");
	});
});
