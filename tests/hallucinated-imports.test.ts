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

const writePkgJson = (
	deps: Record<string, string> = {},
	devDeps: Record<string, string> = {},
): void => {
	writeFile(
		"package.json",
		JSON.stringify({
			name: "test",
			version: "1.0.0",
			dependencies: deps,
			devDependencies: devDeps,
		}),
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

	it("does not false-positive on a type-only import of X when only @types/X is declared", async () => {
		writePkgJson({}, { "@types/mdast": "^4.0.0" });
		writeFile(
			"src/nodes.ts",
			`import type { Blockquote } from "mdast"
export type B = Blockquote
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("resolves scoped imports to their DefinitelyTyped @types name (@scope/pkg -> @types/scope__pkg)", async () => {
		writePkgJson({}, { "@types/scope__pkg": "^1.0.0" });
		writeFile("src/scoped.ts", `import type { Thing } from "@scope/pkg"\nexport type T = Thing\n`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("still flags a truly missing package even when it has no @types backing", async () => {
		writePkgJson({}, { "@types/mdast": "^4.0.0" });
		writeFile("src/x.ts", `import { thing } from "totally-not-real-pkg"\n`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("totally-not-real-pkg");
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

	it('does not false-positive on `import ... from "x"` written inside a string literal in source (e.g. help text)', async () => {
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

	it("does not flag framework virtual modules: astro:*, virtual:*, bun:*", async () => {
		writeFile("package.json", JSON.stringify({ name: "site", dependencies: { astro: "^5.0.0" } }));
		writeFile(
			"src/pages/rss.xml.js",
			`import { getCollection } from "astro:content";
import sw from "virtual:pwa-register";
import { serve } from "bun:test";
`,
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(0);
	});

	it("does not flag Bun runtime and file URL modules", async () => {
		writePkgJson({});
		writeFile(
			"src/runtime.ts",
			`import { spawn } from "bun";
import config from "file:///tmp/generated-config.mjs";
export { spawn, config };
`,
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(0);
	});

	it("does not flag Deno-style remote and registry imports", async () => {
		writePkgJson({});
		writeFile(
			"supabase/functions/update-check/index.ts",
			`import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertEquals } from "jsr:@std/assert";
import { z } from "npm:zod@4";
export { createClient, assertEquals, z };
`,
		);

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toHaveLength(0);
	});

	it("does not flag unplugin virtual icon and font modules when their plugins are installed", async () => {
		writePkgJson({}, { "unplugin-icons": "^0.19.0", "unplugin-fonts": "^1.1.0" });
		writeFile(
			"src/app.tsx",
			`import IconCheck from "~icons/lucide/check";
import "unfonts.css";
export const App = () => <IconCheck />;
`,
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(0);
	});

	it("does not flag self-imports", async () => {
		writeFile("pyproject.toml", `[project]\nname = "fastapi"\ndependencies = ["pydantic"]\n`);
		writeFile(
			"fastapi/applications.py",
			`from fastapi.routing import APIRouter\nfrom fastapi import params\n`,
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(0);
	});

	it("does not flag JS self-imports of the project's own package name", async () => {
		writeFile("package.json", JSON.stringify({ name: "my-lib", dependencies: {} }));
		writeFile("src/index.ts", `import { helper } from "my-lib/internal";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(0);
	});

	it("reads nested package.json manifests anywhere in the tree (e.g. integration/* test apps)", async () => {
		writeFile("package.json", JSON.stringify({ name: "root", dependencies: {} }));
		writeFile(
			"integration/auth/package.json",
			JSON.stringify({ name: "auth-test", dependencies: { jsonwebtoken: "^9.0.0" } }),
		);
		writeFile("integration/auth/src/app.ts", `import jwt from "jsonwebtoken";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(0);
	});

	it("does not flag imports of monorepo workspace package names declared in lerna.json", async () => {
		writeFile("package.json", JSON.stringify({ name: "root", dependencies: { lerna: "^7.0.0" } }));
		writeFile("lerna.json", JSON.stringify({ packages: ["packages/*"], version: "1.0.0" }));
		writeFile("packages/common/package.json", JSON.stringify({ name: "@nestjs/common" }));
		writeFile("packages/core/package.json", JSON.stringify({ name: "@nestjs/core" }));
		writeFile(
			"integration/cors/src/app.module.ts",
			`import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
export class AppModule {}
`,
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(0);
	});

	it("does not flag imports of workspaces declared via package.json#workspaces", async () => {
		writeFile(
			"package.json",
			JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: {} }),
		);
		writeFile("packages/util/package.json", JSON.stringify({ name: "@scope/util" }));
		writeFile("apps/web/src/index.ts", `import { helper } from "@scope/util";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(0);
	});

	it("does not flag imports of workspaces declared via pnpm-workspace.yaml", async () => {
		writeFile("package.json", JSON.stringify({ name: "root", dependencies: {} }));
		writeFile("pnpm-workspace.yaml", `packages:\n  - "packages/*"\n`);
		writeFile("packages/util/package.json", JSON.stringify({ name: "@scope/util" }));
		writeFile("apps/web/src/index.ts", `import { helper } from "@scope/util";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(0);
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

		expect(ruleIds).toEqual(["ai-slop/hallucinated-import", "ai-slop/hallucinated-import"]);
		expect(messages.some((m) => m.includes("ghost-package-cjs"))).toBe(true);
		expect(messages.some((m) => m.includes("ghost-package-esm"))).toBe(true);
	});

	it("does not flag imports that match a tsconfig path alias with a wildcard", async () => {
		writePkgJson({ react: "^19.0.0" });
		writeFile(
			"tsconfig.json",
			JSON.stringify({
				compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
			}),
		);
		writeFile(
			"src/app.ts",
			`import { Button } from "@/components/Button";
import { useThing } from "@/hooks/useThing";
import { foo } from "@/lib/foo";
import { Page } from "@/pages/Home";
`,
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toEqual([]);
	});

	it("does not flag an exact tsconfig path alias (no wildcard)", async () => {
		writePkgJson({});
		writeFile(
			"tsconfig.json",
			JSON.stringify({
				compilerOptions: { baseUrl: ".", paths: { "#shared": ["./shared.ts"] } },
			}),
		);
		writeFile("src/index.ts", `import { x } from "#shared";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toEqual([]);
	});

	it("reads tsconfig path aliases from each workspace package", async () => {
		writeFile(
			"package.json",
			JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: {} }),
		);
		writeFile(
			"packages/web/package.json",
			JSON.stringify({ name: "@scope/web", dependencies: { react: "^19.0.0" } }),
		);
		writeFile(
			"packages/web/tsconfig.json",
			JSON.stringify({
				compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
			}),
		);
		writeFile("packages/web/src/main.ts", `import { Layout } from "@/components/Layout";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toEqual([]);
	});

	it("reads path aliases from jsconfig.json as well as tsconfig.json", async () => {
		writePkgJson({});
		writeFile(
			"jsconfig.json",
			JSON.stringify({
				compilerOptions: { baseUrl: ".", paths: { "~/*": ["./src/*"] } },
			}),
		);
		writeFile("src/index.js", `import { z } from "~/utils/z";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toEqual([]);
	});

	it("resolves bare imports through tsconfig baseUrl directories", async () => {
		writePkgJson({});
		writeFile("pnpm-workspace.yaml", `packages:\n  - "apps/*"\n`);
		writeFile("apps/web/package.json", JSON.stringify({ name: "@scope/web" }));
		writeFile(
			"apps/web/tsconfig.json",
			JSON.stringify({
				compilerOptions: { baseUrl: "." },
			}),
		);
		writeFile("apps/web/hooks/useThing.ts", "export const useThing = () => true;\n");
		writeFile("apps/web/components/Header.ts", `import { useThing } from "hooks/useThing";\n`);

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toEqual([]);
	});

	it("falls back gracefully when tsconfig.json is malformed (no crash, no alias support)", async () => {
		writePkgJson({});
		// Trailing comma — invalid strict JSON. readJson returns null; we proceed without aliases.
		writeFile("tsconfig.json", `{ "compilerOptions": { "paths": { "@/*": ["./src/*"], }, }, }`);
		writeFile("src/index.ts", `import { x } from "@/lib/x";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		// Without alias support, this DOES flag — that's the documented degraded behavior, not a regression.
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("@/lib");
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

	it("resolves psycopg2 provided by psycopg2-binary (discussion #130)", async () => {
		writeFile("pyproject.toml", `[project]\ndependencies = ["psycopg2-binary>=2.9"]\n`);
		writeFile(
			"src/export_db.py",
			`import psycopg2
from psycopg2 import extras
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag import-shaped text inside docstrings (flask example)", async () => {
		writeFile("pyproject.toml", `[project]\ndependencies = ["click"]\n`);
		writeFile(
			"src/config.py",
			`import click


def from_object(obj):
    """Load config from an object.

    Example::

        from yourapplication import default_config
        app.config.from_object(default_config)

    Guessed from the run file if the import name is main.
    """
    return obj
`,
		);
		const diagnostics = await detectHallucinatedImports(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("does not flag imports under `if TYPE_CHECKING:`", async () => {
		writeFile("pyproject.toml", `[project]\ndependencies = ["click"]\n`);
		writeFile(
			"src/app.py",
			`import typing as t

if t.TYPE_CHECKING:
    from _typeshed.wsgi import StartResponse
    from typing_extensions import ParamSpec

x = 1
`,
		);
		const diagnostics = await detectHallucinatedImports(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("recognizes stdlib modules code / codeop / rlcompleter", async () => {
		writeFile("pyproject.toml", `[project]\ndependencies = ["click"]\n`);
		writeFile(
			"src/shell.py",
			`import code\nimport rlcompleter\nfrom codeop import compile_command\n`,
		);
		const diagnostics = await detectHallucinatedImports(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("recognizes platform-specific stdlib modules", async () => {
		writeFile("pyproject.toml", `[project]\ndependencies = ["click"]\n`);
		writeFile(
			"src/platform_io.py",
			`import fcntl
import msvcrt
import posixpath
`,
		);
		const diagnostics = await detectHallucinatedImports(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("resolves install-name vs import-name divergences from the HN/issue-143 report", async () => {
		writeFile(
			"requirements.txt",
			[
				"python-dotenv==1.0.0",
				"google-genai==0.3.0",
				"pillow==10.0.0",
				"opencv-python==4.9.0",
				"pyyaml==6.0",
				"beautifulsoup4==4.12.0",
				"scikit-learn==1.4.0",
				"python-dateutil==2.9.0",
				"pyjwt==2.8.0",
				"",
			].join("\n"),
		);
		writeFile(
			"src/main.py",
			[
				"from dotenv import load_dotenv",
				"from google import genai",
				"from PIL import Image",
				"import cv2",
				"import yaml",
				"import bs4",
				"import sklearn",
				"from dateutil import parser",
				"import jwt",
				"",
			].join("\n"),
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("resolves google-genai for `from google import genai` and still flags a garbage import alongside", async () => {
		writeFile("requirements.txt", "google-genai==0.3.0\n");
		writeFile("src/main.py", `from google import genai\nimport made_up_garbage_pkg\n`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("made_up_garbage_pkg");
	});

	it("still flags an aliased module when its distribution is NOT declared", async () => {
		writeFile("requirements.txt", "requests==2.31.0\n");
		writeFile("src/main.py", `import cv2\n`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("cv2");
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

	it("does not flag imports of the project's own internal package laid out under src/<pkg>/", async () => {
		writeFile(
			"pyproject.toml",
			`[project]
name = "pytest"
dependencies = ["pluggy>=1.5"]
`,
		);
		writeFile("src/_pytest/__init__.py", "");
		writeFile("src/_pytest/runner.py", "");
		writeFile(
			"src/_pytest/main.py",
			`from _pytest.runner import run
from _pytest import runner
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());
		expect(diagnostics).toHaveLength(0);
	});

	it("does not flag imports of a top-level package directory at the repo root", async () => {
		writeFile("pyproject.toml", `[project]\nname = "demo"\n`);
		writeFile("mypkg/__init__.py", "");
		writeFile("mypkg/sub.py", "");
		writeFile("app/main.py", `from mypkg.sub import something\n`);
		writeFile("app/__init__.py", "");
		const diagnostics = await detectHallucinatedImports(buildContext());
		expect(diagnostics).toHaveLength(0);
	});

	it("does not truncate pyproject dependencies when a package uses extras", async () => {
		writeFile(
			"pyproject.toml",
			`[project]
name = "demo"
dependencies = [
  "pydantic[email] >= 2.0.0",
  "django == 5.1.15",
  "fastapi >= 0.110.0",
]
`,
		);
		writeFile(
			"src/app.py",
			`from pydantic import BaseModel
import django
from starlette.requests import Request
`,
		);
		const diagnostics = await detectHallucinatedImports(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("uses nested Python manifests only for files under that nested project", async () => {
		writeFile("pyproject.toml", `[project]\nname = "root-demo"\ndependencies = ["requests"]\n`);
		writeFile(
			"packages/worker/pyproject.toml",
			`[project]
name = "worker"
dependencies = ["pydantic[email] >= 2.0.0"]
`,
		);
		writeFile("packages/worker/src/worker/job.py", `from pydantic import BaseModel\n`);
		writeFile("src/root.py", `from pydantic import BaseModel\n`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].filePath).toBe(path.join("src", "root.py"));
		expect(diagnostics[0].message).toContain("pydantic");
	});

	it("resolves common Python framework and distribution-backed import names", async () => {
		writeFile(
			"pyproject.toml",
			`[project]
dependencies = [
  "paddlepaddle>=3.2.1",
  "langchain-community>=0.3",
  "huggingface-hub>=0.22",
  "markdown-it-py>=3",
  "cron-descriptor==1.4.3",
  "email-validator==2.2.0",
  "e2b-code-interpreter~=1.0",
  "django-phonenumber-field==7.3.0",
  "python-frontmatter",
  "opentelemetry-api>=1.39.0",
  "ag-ui-protocol>=0.1.10",
]
`,
		);
		writeFile(
			"src/integrations.py",
			`import paddle
import langchain_core
import langchain_community
import huggingface_hub
import markdown_it
import cron_descriptor
import email_validator
import e2b_code_interpreter
import phonenumber_field
import frontmatter
import opentelemetry
import ag_ui
`,
		);
		const diagnostics = await detectHallucinatedImports(buildContext());
		expect(diagnostics).toEqual([]);
	});

	it("resolves deps declared only in [project.optional-dependencies] extras", async () => {
		writeFile(
			"pyproject.toml",
			`[project]
name = "demo"
dependencies = ["requests>=2.0"]

[project.optional-dependencies]
yaml = ["pyyaml>=6.0"]
img = ["pillow>=10.0", "opencv-python>=4.9"]
`,
		);
		writeFile(
			"src/main.py",
			`import requests
import yaml
from PIL import Image
import cv2
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});
});

describe("ai-slop/unused-import — Python re-export convention", () => {
	let tmpDir: string;
	let writeFile: (relPath: string, content: string) => string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-reexport-"));
		writeFile = (relPath, content) => {
			const full = path.join(tmpDir, relPath);
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, content);
			return full;
		};
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("does not flag PEP 484 `from X import Y as Y` re-export pattern in __init__.py", async () => {
		const initPath = writeFile(
			"src/myapp/__init__.py",
			[
				"from .app import App as App",
				"from .config import Config as Config",
				"from .ctx import after_this_request as after_this_request",
				"",
			].join("\n"),
		);

		const { analyzeFile, getUnusedSymbols } = await import(
			"../src/engines/ai-slop/unused-imports.js"
		);
		const analyzed = analyzeFile(initPath);
		expect(analyzed).not.toBeNull();
		if (!analyzed) return;
		const unused = getUnusedSymbols(analyzed.lines, analyzed.symbols, analyzed.importLines);
		expect(unused).toHaveLength(0);
	});

	it("still flags `from X import Y` when Y is genuinely unused", async () => {
		const filePath = writeFile(
			"src/main.py",
			["from collections import OrderedDict", "print('hello')", ""].join("\n"),
		);

		const { analyzeFile, getUnusedSymbols } = await import(
			"../src/engines/ai-slop/unused-imports.js"
		);
		const analyzed = analyzeFile(filePath);
		expect(analyzed).not.toBeNull();
		if (!analyzed) return;
		const unused = getUnusedSymbols(analyzed.lines, analyzed.symbols, analyzed.importLines);
		expect(unused.some((s) => s.name === "OrderedDict")).toBe(true);
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
