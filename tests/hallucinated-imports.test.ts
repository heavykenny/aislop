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
		expect(diag.filePath).toBe("src/index.ts");
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

	it("does not false-positive on import lines inside multi-line template literals (docs code samples)", async () => {
		writePkgJson({ react: "^19.0.0" });
		writeFile(
			"web/src/Hero.jsx",
			[
				`import { useState } from "react";`,
				`const snippet = {`,
				`  source: \`import { getTasks } from "wasp/client/operations";`,
				`import { HttpError } from "wasp/server";`,
				`export const x = 1;\``,
				`};`,
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

	it("does not flag Node package.json imports field subpath patterns (#*.js)", async () => {
		writeFile(
			"package.json",
			JSON.stringify({
				name: "eve-like",
				imports: {
					"#*.js": "./src/*.ts",
					"#compiled/*": "./dist/compiled/*",
				},
			}),
		);
		writeFile(
			"src/app.ts",
			`import { x } from "#runtime/input/types.js";
import { y } from "#shared/json.js";
import { z } from "#compiled/manifest.js";
`,
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toEqual([]);
	});

	it("uses the nearest nested package.json for files under that package", async () => {
		writeFile("package.json", JSON.stringify({ name: "root", dependencies: {} }));
		writeFile(
			"web/package.json",
			JSON.stringify({
				name: "web",
				dependencies: { "@docusaurus/core": "~3.10.1", react: "^19.0.0" },
			}),
		);
		writeFile("web/src/Page.tsx", `import React from "react";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toEqual([]);
	});

	it("does not flag Docusaurus virtual imports when @docusaurus/* is installed", async () => {
		writeFile(
			"web/package.json",
			JSON.stringify({
				name: "web",
				dependencies: { "@docusaurus/core": "~3.10.1" },
			}),
		);
		writeFile(
			"web/src/Link.tsx",
			`import Link from "@docusaurus/Link";
import Head from "@docusaurus/Head";
import Tabs from "@theme/Tabs";
import Logo from "@site/src/components/Logo";
`,
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toEqual([]);
	});

	it("does not flag wasp SDK imports in apps with main.wasp", async () => {
		writeFile(
			"mage/package.json",
			JSON.stringify({ name: "mage", dependencies: { react: "^19.0.0" } }),
		);
		writeFile("mage/main.wasp", "app MageApp {}\n");
		writeFile(
			"mage/src/App.tsx",
			`import { useAuth } from "wasp/client/auth";
import { Link } from "wasp/client/router";
`,
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toEqual([]);
	});

	it("does not flag deep nested workspace package names (e.g. @wasp.sh/lib-auth)", async () => {
		writeFile("package.json", JSON.stringify({ name: "root", dependencies: {} }));
		writeFile(
			"waspc/data/Generator/libs/auth/package.json",
			JSON.stringify({ name: "@wasp.sh/lib-auth", dependencies: { lucia: "^3.0.0" } }),
		);
		writeFile(
			"waspc/data/Generator/libs/auth/src/index.ts",
			`import { Lucia } from "lucia";
import { helper } from "@wasp.sh/lib-auth/internal";
`,
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toEqual([]);
	});

	it("does not flag package.json imports when the manifest contains https repository URLs", async () => {
		writeFile(
			"package.json",
			JSON.stringify({
				name: "pkg-with-urls",
				homepage: "https://example.com/docs",
				repository: { url: "git+https://github.com/org/repo.git" },
				imports: { "#*.js": "./src/*.ts" },
			}),
		);
		writeFile("src/main.ts", `import { helper } from "#internal/helper.js";\n`);
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

	it("reads local aliases from Vite shared alias objects", async () => {
		writePkgJson({ vue: "^3.0.0" });
		writeFile(
			"vite.shared.ts",
			[
				`import path from "node:path";`,
				`export const aliases = {`,
				`  vue: "vue/dist/vue.esm-bundler.js",`,
				`  dashboard: path.resolve("./app/javascript/dashboard"),`,
				`  shared: path.resolve("./app/javascript/shared"),`,
				`  next: path.resolve("./app/javascript/dashboard/components-next"),`,
				`};`,
				``,
			].join("\n"),
		);
		writeFile(
			"app/javascript/dashboard/components-next/filter/provider.js",
			[
				`import filterHelpers from "dashboard/helper/filterHelpers";`,
				`import sharedHelpers from "shared/helpers/filterHelpers";`,
				`import Provider from "next/filter/Provider";`,
				``,
			].join("\n"),
		);

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toEqual([]);
	});

	it("reads local aliases from Vite resolve.alias arrays", async () => {
		writePkgJson({});
		writeFile(
			"vite.config.ts",
			[
				`import path from "node:path";`,
				`export default {`,
				`  resolve: {`,
				`    alias: [`,
				`      { find: "@", replacement: path.resolve(__dirname, "src") },`,
				`      { find: "models", replacement: path.resolve(__dirname, "src/models") },`,
				`    ],`,
				`  },`,
				`};`,
				``,
			].join("\n"),
		);
		writeFile(
			"src/app.ts",
			[
				`import { Button } from "@/components/Button";`,
				`import { User } from "models/User";`,
				``,
			].join("\n"),
		);

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

	it("reads path aliases from tsconfig.json with block comments (JSONC)", async () => {
		writePkgJson({ react: "^19.0.0" });
		writeFile(
			"tsconfig.json",
			`{
  "compilerOptions": {
    /* Bundler mode */
    "moduleResolution": "Bundler",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}`,
		);
		writeFile("src/app.ts", `import { api } from "@/lib/api";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toEqual([]);
	});

	it("falls back gracefully when tsconfig.json is malformed (no crash, no alias support)", async () => {
		writePkgJson({});
		writeFile("tsconfig.json", `{ "compilerOptions": { "paths": { "@/*": } } }`);
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

	it("resolves azure namespace imports from azure-* distributions (#235)", async () => {
		writeFile(
			"pyproject.toml",
			`[project]
name = "repro"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "azure-core>=1.41.0",
  "azure-identity>=1.25.3",
  "azure-mgmt-containerservice>=40.2.0",
]
`,
		);
		writeFile(
			"app.py",
			`from azure.core.exceptions import AzureError
from azure.identity import DefaultAzureCredential
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("still flags azure imports when no azure-* distribution is declared", async () => {
		writeFile("pyproject.toml", `[project]\ndependencies = ["requests>=2.31"]\n`);
		writeFile("app.py", `from azure.core.exceptions import AzureError\n`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("azure");
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
		// Diagnostics report POSIX-relative paths on every OS (see utils/paths relativePosix).
		expect(diagnostics[0].filePath).toBe("src/root.py");
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

	it("parses a dependency array whose trailing comments contain apostrophes or brackets", async () => {
		// Regression: an un-terminated quote from a comment apostrophe (e.g.
		// `# the dashboard's use`) or a bracket in a comment (`# see [tool.x]`)
		// used to corrupt the array scanner and silently drop every dependency.
		writeFile(
			"pyproject.toml",
			`[project]
name = "demo"
requires-python = ">=3.12"        # pr-crew's floor wins
dependencies = [
    "typer>=0.12",                # higher of projdash 0.9 / pr-crew 0.12
    "rich>=13.0",
    "uvicorn[standard]>=0.34",
    "web-common",     # workspace member; the dashboard's (lazy) use, see [tool.uv.sources]
]
`,
		);
		writeFile(
			"src/app.py",
			`import typer
import rich
import uvicorn
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

describe("detectHallucinatedImports: uv workspace", () => {
	// A uv workspace: one root pyproject.toml with [tool.uv.workspace] and no
	// [project] section of its own, plus per-package pyproject.toml files under
	// packages/<name>/. Members share one lockfile/.venv, so a member may import
	// a root-declared dep OR a sibling member package. Mirrors ~/schoen-lab.
	const writeUvWorkspace = (): void => {
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]
members = [
    "packages/process_safe",
    "packages/web_common",
    "packages/inference_manager",
]

[dependency-groups]
dev = ["pytest>=7.0"]
`,
		);
		writeFile(
			"packages/process_safe/pyproject.toml",
			`[project]
name = "process-safe"
version = "0.1.0"
dependencies = []

[tool.hatch.build.targets.wheel]
packages = ["src/process_safe"]
`,
		);
		writeFile("packages/process_safe/src/process_safe/__init__.py", "");
		writeFile(
			"packages/web_common/pyproject.toml",
			`[project]
name = "web-common"
version = "0.1.0"
dependencies = ["fastapi>=0.115", "jinja2>=3.1"]

[tool.hatch.build.targets.wheel]
packages = ["src/web_common"]
`,
		);
		writeFile("packages/web_common/src/web_common/__init__.py", "");
		writeFile(
			"packages/inference_manager/pyproject.toml",
			`[project]
name = "inference-manager"
version = "0.1.0"
dependencies = ["uvicorn>=0.30"]

[tool.hatch.build.targets.wheel]
packages = ["src/inference_manager"]
`,
		);
		writeFile("packages/inference_manager/src/inference_manager/__init__.py", "");
	};

	it("does not flag a sibling workspace-member import from another member", async () => {
		writeUvWorkspace();
		writeFile(
			"packages/inference_manager/src/inference_manager/app.py",
			`import uvicorn
from web_common import Elm
from process_safe import run_captured
from inference_manager.util import helper
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag a member importing a third-party dep declared only by a sibling member", async () => {
		// One shared lockfile/.venv installs every member's deps, so process_safe
		// (which declares nothing) may still import `fastapi`, declared only by
		// the web_common sibling, at runtime.
		writeUvWorkspace();
		writeFile(
			"packages/process_safe/src/process_safe/net.py",
			`from fastapi import FastAPI\nimport uvicorn\n`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag a repo-root script importing a dep declared by a workspace member", async () => {
		// tools/ scripts live outside packages/ but still run against the shared
		// workspace .venv, so importing a member-declared dep is not hallucinated.
		writeUvWorkspace();
		writeFile("tools/report.py", `import uvicorn\nfrom fastapi import FastAPI\n`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag a member importing a dep declared only under the workspace root", async () => {
		// Root declares the dep in a [project.optional-dependencies] extra; the
		// member has no manifest of its own beyond its name.
		writeFile(
			"pyproject.toml",
			`[project]
name = "workspace-root"
version = "0.1.0"
dependencies = ["rich>=13.0"]

[tool.uv.workspace]
members = ["packages/tool"]
`,
		);
		writeFile(
			"packages/tool/pyproject.toml",
			`[project]
name = "tool"
version = "0.1.0"
dependencies = []
`,
		);
		writeFile("packages/tool/src/tool/__init__.py", "");
		writeFile("packages/tool/src/tool/cli.py", `import rich\nfrom tool import version\n`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("still flags a truly hallucinated import inside a uv workspace member", async () => {
		writeUvWorkspace();
		writeFile(
			"packages/web_common/src/web_common/render.py",
			`from fastapi import FastAPI
import totally_made_up_workspace_pkg
`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("totally_made_up_workspace_pkg");
	});

	it("honors [tool.uv.workspace].exclude: an excluded project's deps do not suppress findings", async () => {
		// `exclude` globs remove directories that `members` globs matched; uv does
		// not install an excluded project into the shared .venv, so its deps must
		// not vouch for imports elsewhere in the workspace.
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]
members = ["packages/*"]
exclude = ["packages/seeds"]
`,
		);
		writeFile(
			"packages/app/pyproject.toml",
			`[project]
name = "app"
version = "0.1.0"
dependencies = ["requests>=2.0"]
`,
		);
		writeFile("packages/app/src/app/__init__.py", "");
		writeFile(
			"packages/seeds/pyproject.toml",
			`[project]
name = "seeds"
version = "0.1.0"
dependencies = ["sqlalchemy>=2.0"]
`,
		);
		writeFile("packages/seeds/src/seeds/__init__.py", "");
		// sqlalchemy is declared ONLY by the excluded project; importing it from a
		// real member is exactly what uv would fail to resolve.
		writeFile("packages/app/src/app/db.py", `import requests\nimport sqlalchemy\n`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("sqlalchemy");
	});

	it("supports nested member and exclude globs", async () => {
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]
members = ["workspaces/*/packages/*"]
exclude = ["workspaces/*/packages/seed-*"]
`,
		);
		writeFile(
			"workspaces/team/packages/app/pyproject.toml",
			`[project]
name = "app"
version = "0.1.0"
dependencies = []
`,
		);
		writeFile("workspaces/team/packages/app/src/app/__init__.py", "");
		writeFile(
			"workspaces/team/packages/shared/pyproject.toml",
			`[project]
name = "shared"
version = "0.1.0"
dependencies = ["sqlalchemy>=2.0"]
`,
		);
		writeFile("workspaces/team/packages/shared/src/shared/__init__.py", "");
		writeFile(
			"workspaces/team/packages/seed-data/pyproject.toml",
			`[project]
name = "seed-data"
version = "0.1.0"
dependencies = ["boto3>=1.0"]
`,
		);
		writeFile("workspaces/team/packages/seed-data/src/seed_data/__init__.py", "");
		writeFile("workspaces/team/packages/app/src/app/db.py", `import sqlalchemy\nimport boto3\n`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("boto3");
	});

	it("does not let a member star span path separators", async () => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeFile(
			"packages/team/pyproject.toml",
			`[project]\nname = "team"\nversion = "0.1.0"\ndependencies = []\n`,
		);
		writeFile("packages/team/src/team/__init__.py", "");
		writeFile(
			"packages/team/service/pyproject.toml",
			`[project]\nname = "service"\nversion = "0.1.0"\ndependencies = ["deep-only"]\n`,
		);
		writeFile("packages/team/service/src/service/__init__.py", "");
		writeFile("tools/report.py", "import deep_only\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("deep_only");
	});

	it("normalizes internal relative components in member globs", async () => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/../libs/*"]\n`);
		writeFile(
			"libs/shared/pyproject.toml",
			`[project]\nname = "shared"\nversion = "0.1.0"\ndependencies = ["sqlalchemy"]\n`,
		);
		writeFile("libs/shared/src/shared/__init__.py", "");
		writeFile("tools/report.py", "import sqlalchemy\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not read literal workspace members outside the workspace root", async () => {
		const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-external-workspace-"));
		try {
			fs.writeFileSync(
				path.join(externalDir, "pyproject.toml"),
				`[project]\nname = "external"\nversion = "0.1.0"\ndependencies = ["outside-only"]\n`,
			);
			const externalMember = path.relative(tmpDir, externalDir).split(path.sep).join("/");
			writeFile(
				"packages/shared/pyproject.toml",
				`[project]\nname = "shared"\nversion = "0.1.0"\ndependencies = ["sqlalchemy"]\n`,
			);
			writeFile("packages/shared/src/shared/__init__.py", "");
			writeFile(
				"pyproject.toml",
				`[tool.uv.workspace]\nmembers = ["packages/*", "${externalMember}"]\n`,
			);
			writeFile("src/main.py", "import outside_only\n");

			const diagnostics = await detectHallucinatedImports(buildContext());

			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0].message).toContain("outside_only");
		} finally {
			fs.rmSync(externalDir, { recursive: true, force: true });
		}
	});

	it("does not read a workspace pyproject symlink outside the project", async () => {
		const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-external-pyproject-"));
		try {
			const externalManifest = path.join(externalDir, "pyproject.toml");
			fs.writeFileSync(
				externalManifest,
				`[project]\nname = "external"\nversion = "0.1.0"\ndependencies = ["outside-only"]\n`,
			);
			writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
			writeFile(
				"packages/app/pyproject.toml",
				`[project]\nname = "app"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
			);
			writeFile("packages/app/src/app/__init__.py", "");
			fs.mkdirSync(path.join(tmpDir, "packages", "shared"), { recursive: true });
			fs.symlinkSync(externalManifest, path.join(tmpDir, "packages", "shared", "pyproject.toml"));
			writeFile("packages/shared/src/shared/app.py", "import fastapi\nimport outside_only\n");

			const diagnostics = await detectHallucinatedImports(buildContext());

			expect(diagnostics).toHaveLength(2);
			expect(diagnostics.some((diagnostic) => diagnostic.message.includes("fastapi"))).toBe(true);
			expect(diagnostics.some((diagnostic) => diagnostic.message.includes("outside_only"))).toBe(
				true,
			);
		} finally {
			fs.rmSync(externalDir, { recursive: true, force: true });
		}
	});

	it("matches uv excludes when a star spans path separators", async () => {
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]
members = ["packages/team/app"]
exclude = ["packages/*"]
`,
		);
		writeFile(
			"packages/team/app/pyproject.toml",
			`[project]
name = "app"
version = "0.1.0"
dependencies = ["sqlalchemy>=2.0"]
`,
		);
		writeFile("packages/team/app/src/app/__init__.py", "");
		writeFile("packages/team/app/src/app/db.py", "import sqlalchemy\n");
		writeFile("tools/report.py", "import sqlalchemy\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].filePath).toBe("tools/report.py");
		expect(diagnostics[0].message).toContain("sqlalchemy");
	});

	it("keeps a deeply nested excluded member's own dependency scope", async () => {
		writeFile(
			"pyproject.toml",
			`[tool.uv.workspace]
members = ["workspaces/company/team/packages/*"]
exclude = ["workspaces/company/team/packages/seeds"]
`,
		);
		writeFile(
			"workspaces/company/team/packages/app/pyproject.toml",
			`[project]
name = "app"
version = "0.1.0"
dependencies = ["fastapi>=0.115"]
`,
		);
		writeFile("workspaces/company/team/packages/app/src/app/__init__.py", "");
		writeFile(
			"workspaces/company/team/packages/seeds/pyproject.toml",
			`[project]
name = "seeds"
version = "0.1.0"
dependencies = ["sqlalchemy>=2.0"]
`,
		);
		writeFile("workspaces/company/team/packages/seeds/src/seeds/__init__.py", "");
		writeFile(
			"workspaces/company/team/packages/seeds/src/seeds/load.py",
			"import sqlalchemy\nimport fastapi\n",
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");
	});

	it("does not share workspace dependencies with an independent nested project", async () => {
		writeFile(
			"pyproject.toml",
			`[project]
name = "workspace-root"
version = "0.1.0"
dependencies = ["rich>=13.0"]

[tool.uv.workspace]
members = ["packages/*"]
`,
		);
		writeFile(
			"packages/api/pyproject.toml",
			`[project]
name = "api"
version = "0.1.0"
dependencies = ["fastapi>=0.115"]
`,
		);
		writeFile("packages/api/src/api/__init__.py", "");
		writeFile(
			"standalone/service/pyproject.toml",
			`[project]
name = "demo"
version = "0.1.0"
dependencies = ["pydantic>=2.0"]
`,
		);
		writeFile("standalone/service/src/standalone_service/__init__.py", "");
		writeFile(
			"standalone/service/src/standalone_service/app.py",
			"import pydantic\nimport fastapi\nimport rich\n",
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.some((diagnostic) => diagnostic.message.includes("fastapi"))).toBe(true);
		expect(diagnostics.some((diagnostic) => diagnostic.message.includes("rich"))).toBe(true);

		const subtreeDiagnostics = await detectHallucinatedImports({
			...buildContext(),
			rootDirectory: path.join(tmpDir, "standalone", "service", "src"),
		});
		expect(subtreeDiagnostics).toHaveLength(2);
		expect(subtreeDiagnostics.some((diagnostic) => diagnostic.message.includes("fastapi"))).toBe(
			true,
		);
		expect(subtreeDiagnostics.some((diagnostic) => diagnostic.message.includes("rich"))).toBe(true);
	});

	it.each([
		["requirements.txt", "pydantic>=2.0\n"],
		["Pipfile", `[packages]\npydantic = "*"\n`],
	])("isolates an independent nested project declared by %s", async (manifestName, content) => {
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
		writeFile(
			"packages/api/pyproject.toml",
			`[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi>=0.115"]\n`,
		);
		writeFile("packages/api/src/api/__init__.py", "");
		writeFile(path.join("standalone", "service", manifestName), content);
		writeFile("standalone/service/src/service/app.py", "import pydantic\nimport fastapi\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("fastapi");

		const subtreeDiagnostics = await detectHallucinatedImports({
			...buildContext(),
			rootDirectory: path.join(tmpDir, "standalone", "service", "src"),
		});
		expect(subtreeDiagnostics).toHaveLength(1);
		expect(subtreeDiagnostics[0].message).toContain("fastapi");
	});

	it("omits unmanaged projects from workspace dependency sharing", async () => {
		writeFile(
			"pyproject.toml",
			`[project]
name = "workspace-root"
version = "0.1.0"
dependencies = ["rich>=13.0"]

[tool.uv.workspace]
members = ["packages/*"]
`,
		);
		writeFile(
			"packages/app/pyproject.toml",
			`[project]\nname = "app"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n`,
		);
		writeFile("packages/app/src/app/__init__.py", "");
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
		writeFile("packages/unmanaged/src/unmanaged/__init__.py", "");
		writeFile(
			"packages/unmanaged/src/unmanaged/app.py",
			"import boto3\nimport fastapi\nimport rich\n",
		);
		writeFile("src/main.py", "import fastapi\nimport boto3\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(3);
		expect(
			diagnostics.some(
				(diagnostic) =>
					diagnostic.filePath === "src/main.py" && diagnostic.message.includes("boto3"),
			),
		).toBe(true);
		expect(
			diagnostics.some(
				(diagnostic) =>
					diagnostic.filePath.includes("unmanaged") && diagnostic.message.includes("fastapi"),
			),
		).toBe(true);
		expect(
			diagnostics.some(
				(diagnostic) =>
					diagnostic.filePath.includes("unmanaged") && diagnostic.message.includes("rich"),
			),
		).toBe(true);
	});

	it("fails closed when workspace patterns exceed the expansion budget", async () => {
		const members = [
			"packages/shared",
			...Array.from({ length: 128 }, (_, index) => `missing/package-${index}`),
		];
		writeFile("pyproject.toml", `[tool.uv.workspace]\nmembers = ${JSON.stringify(members)}\n`);
		writeFile(
			"packages/shared/pyproject.toml",
			`[project]
name = "shared"
version = "0.1.0"
dependencies = ["outside-only"]
`,
		);
		writeFile("packages/shared/src/shared/__init__.py", "");
		writeFile("tools/report.py", "import outside_only\n");

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("outside_only");
	});

	it("does not apply workspace deps to files inside an excluded project", async () => {
		// The flip side of `exclude`: a file under the excluded directory is not
		// installed into the shared .venv either, so it may not lean on deps that
		// only real members declare - it is checked against its own manifest.
		writeFile(
			"pyproject.toml",
			`[project]
name = "workspace-root"
version = "0.1.0"
dependencies = ["rich>=13.0"]

[tool.uv.workspace]
members = ["packages/*"]
exclude = ["packages/seeds"]
`,
		);
		writeFile(
			"packages/app/pyproject.toml",
			`[project]
name = "app"
version = "0.1.0"
dependencies = ["fastapi>=0.115"]
`,
		);
		writeFile("packages/app/src/app/__init__.py", "");
		writeFile(
			"packages/seeds/pyproject.toml",
			`[project]
name = "seeds"
version = "0.1.0"
dependencies = ["sqlalchemy>=2.0"]
`,
		);
		writeFile("packages/seeds/src/seeds/__init__.py", "");
		// fastapi is declared only by the included member; the excluded project
		// does not share its .venv, so uv would not resolve this import.
		writeFile(
			"packages/seeds/src/seeds/load.py",
			`import sqlalchemy\nimport fastapi\nimport rich\n`,
		);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.some((diagnostic) => diagnostic.message.includes("fastapi"))).toBe(true);
		expect(diagnostics.some((diagnostic) => diagnostic.message.includes("rich"))).toBe(true);
		expect(
			diagnostics.every((diagnostic) => diagnostic.filePath === "packages/seeds/src/seeds/load.py"),
		).toBe(true);
	});

	it("applies ancestor workspace deps when scanning a member subdirectory", async () => {
		// `aislop scan packages/web_common/src` finds no manifest under the scan
		// root; the ancestor [tool.uv.workspace] must still enable the rule and
		// supply the shared dependency set.
		writeUvWorkspace();
		writeFile(
			"packages/web_common/src/web_common/render.py",
			`from fastapi import FastAPI
import uvicorn
import totally_made_up_workspace_pkg
`,
		);
		const context = {
			...buildContext(),
			rootDirectory: path.join(tmpDir, "packages", "web_common", "src"),
		};

		const diagnostics = await detectHallucinatedImports(context);

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("totally_made_up_workspace_pkg");
	});

	it("leaves non-workspace nested-manifest isolation unchanged (no [tool.uv.workspace])", async () => {
		// Same layout minus the workspace table: a plain repo with a nested
		// package. Cross-package imports must STILL be flagged (regression guard).
		writeFile(
			"pyproject.toml",
			`[project]\nname = "root-demo"\nversion = "0.1.0"\ndependencies = ["requests"]\n`,
		);
		writeFile(
			"packages/worker/pyproject.toml",
			`[project]\nname = "worker"\nversion = "0.1.0"\ndependencies = ["pydantic>=2.0"]\n`,
		);
		writeFile("packages/worker/src/worker/__init__.py", "");
		writeFile(
			"packages/other/pyproject.toml",
			`[project]\nname = "other"\nversion = "0.1.0"\ndependencies = []\n`,
		);
		writeFile("packages/other/src/other/__init__.py", "");
		// `other` is not a declared dep of `worker`, and there is no workspace to
		// share names, so importing it from worker is (correctly) flagged.
		writeFile("packages/worker/src/worker/job.py", `import pydantic\nimport other\n`);

		const diagnostics = await detectHallucinatedImports(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("other");
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
		expect(diagnostics[0].filePath).toBe("src/index.ts");
		expect(diagnostics[0].message).toContain("made-up-js");
	});
});
