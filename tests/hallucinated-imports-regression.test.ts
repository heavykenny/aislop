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

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-hi-regression-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("hallucinated-import regressions — still catches real slop after FP fixes", () => {
	it("flags aliases declared only by a referenced TypeScript config", async () => {
		writeFile("package.json", JSON.stringify({ name: "root", workspaces: ["apps/*"] }));
		writeFile("apps/playground/package.json", JSON.stringify({ name: "playground" }));
		writeFile(
			"apps/playground/tsconfig.json",
			'{ "references": [{ "path": "./tsconfig.frontend.json" },] }',
		);
		writeFile(
			"apps/playground/tsconfig.frontend.json",
			JSON.stringify({ compilerOptions: { paths: { "$hooks/*": ["./src/hooks/*"] } } }),
		);
		writeFile(
			"apps/playground/src/hooks/useWorkspace.ts",
			"export const useWorkspace = () => null;\n",
		);
		writeFile(
			"apps/playground/src/App.ts",
			'import { useWorkspace } from "$hooks/useWorkspace";\nuseWorkspace();\n',
		);

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toHaveLength(1);
		expect(diags[0].filePath).toBe("apps/playground/src/App.ts");
		expect(diags[0].message).toContain('Imports "$hooks"');
	});

	it("accepts aliases inherited through TypeScript config extends", async () => {
		writeFile("package.json", JSON.stringify({ name: "root", workspaces: ["apps/*"] }));
		writeFile("apps/playground/package.json", JSON.stringify({ name: "playground" }));
		writeFile(
			"apps/playground/tsconfig.base.json",
			JSON.stringify({ compilerOptions: { paths: { "$hooks/*": ["./src/hooks/*"] } } }),
		);
		writeFile(
			"apps/playground/tsconfig.json",
			JSON.stringify({ extends: "./tsconfig.base", include: ["src/**/*.ts"] }),
		);
		writeFile(
			"apps/playground/src/hooks/useWorkspace.ts",
			"export const useWorkspace = () => null;\n",
		);
		writeFile(
			"apps/playground/src/App.ts",
			'import { useWorkspace } from "$hooks/useWorkspace";\nuseWorkspace();\n',
		);

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toEqual([]);
	});

	it("prefers an exact extensionless TypeScript config over its json sibling", async () => {
		writeFile("package.json", JSON.stringify({ name: "root" }));
		writeFile(
			"tsconfig.base",
			JSON.stringify({ compilerOptions: { paths: { "$exact/*": ["./src/exact/*"] } } }),
		);
		writeFile(
			"tsconfig.base.json",
			JSON.stringify({ compilerOptions: { paths: { "$sibling/*": ["./src/sibling/*"] } } }),
		);
		writeFile("tsconfig.json", JSON.stringify({ extends: "./tsconfig.base" }));
		writeFile("src/exact/value.ts", "export const value = true;\n");
		writeFile("src/app.ts", 'import { value } from "$exact/value";\nvalue;\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toEqual([]);
	});

	it("does not resolve a relative TypeScript extends path as a config directory", async () => {
		writeFile("package.json", JSON.stringify({ name: "root" }));
		writeFile(
			"config-dir/tsconfig.json",
			JSON.stringify({ compilerOptions: { paths: { "$invalid/*": ["../src/invalid/*"] } } }),
		);
		writeFile("tsconfig.json", JSON.stringify({ extends: "./config-dir" }));
		writeFile("src/invalid/value.ts", "export const value = true;\n");
		writeFile("src/app.ts", 'import { value } from "$invalid/value";\nvalue;\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toEqual([
			expect.objectContaining({
				filePath: "src/app.ts",
				message: expect.stringContaining("$invalid"),
			}),
		]);
	});

	it("accepts colon-namespaced virtual modules", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
		writeFile("src/virtual-modules.d.ts", 'declare module "likec4:rpc";\n');
		writeFile("src/rpc.ts", 'import { rpc } from "likec4:rpc";\nrpc();\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toEqual([]);
	});

	it("uses unchanged ambient declarations as evidence during scoped scans", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
		const declarationPath = path.join(tmpDir, "src/virtual-modules.d.ts");
		const importerPath = path.join(tmpDir, "src/rpc.ts");
		writeFile("src/virtual-modules.d.ts", 'declare module "likec4:rpc";\n');
		writeFile("src/rpc.ts", 'import { rpc } from "likec4:rpc";\nrpc();\n');

		const diags = await detectHallucinatedImports({
			...buildContext(),
			files: [importerPath],
			projectFiles: [declarationPath, importerPath],
		});

		expect(diags).toEqual([]);
	});

	it("ignores ambient declaration text inside comments", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
		writeFile(
			"src/virtual-modules.d.ts",
			[
				'// declare module "totally-fake:module";',
				'/* declare module "totally-fake:module"; */',
			].join("\n"),
		);
		writeFile("src/rpc.ts", 'import { rpc } from "totally-fake:module";\nrpc();\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("totally-fake:module");
	});

	it("flags an unknown colon-namespaced import without module evidence", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
		writeFile("src/rpc.ts", 'import { rpc } from "totally-fake:module";\nrpc();\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("totally-fake:module");
	});

	it("does not follow referenced TypeScript configs outside the scan root", async () => {
		const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-hi-outside-config-"));
		try {
			const outsideConfig = path.join(outsideDir, "tsconfig.json");
			fs.writeFileSync(
				outsideConfig,
				JSON.stringify({ compilerOptions: { paths: { "$outside/*": ["./src/*"] } } }),
			);
			writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
			writeFile("tsconfig.json", JSON.stringify({ references: [{ path: outsideConfig }] }));
			writeFile("src/app.ts", 'import { value } from "$outside/value";\nvalue();\n');

			const diags = await detectHallucinatedImports(buildContext());

			expect(diags).toHaveLength(1);
			expect(diags[0].message).toContain("$outside");
		} finally {
			fs.rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	it("does not resolve baseUrl modules outside the scan root", async () => {
		const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-hi-outside-baseurl-"));
		try {
			fs.writeFileSync(path.join(outsideDir, "secretmod.ts"), "export const secret = true;\n");
			writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
			writeFile("tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: outsideDir } }));
			writeFile("src/app.ts", 'import { secret } from "secretmod";\nsecret();\n');

			const diags = await detectHallucinatedImports(buildContext());

			expect(diags).toHaveLength(1);
			expect(diags[0].message).toContain("secretmod");
		} finally {
			fs.rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	it("does not accept extensionless files as baseUrl module evidence", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
		writeFile("tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: "." } }));
		writeFile("ghost_module", "not a JavaScript module\n");
		writeFile("src/app.ts", 'import value from "ghost_module";\nvalue();\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("ghost_module");
	});

	it("scopes TypeScript aliases to their config directory", async () => {
		writeFile(
			"package.json",
			JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: {} }),
		);
		writeFile("tsconfig.json", JSON.stringify({ references: [{ path: "./packages/a" }] }));
		writeFile("packages/a/package.json", JSON.stringify({ name: "a" }));
		writeFile(
			"packages/a/tsconfig.json",
			JSON.stringify({ compilerOptions: { paths: { "#only-a": ["./src/local.ts"] } } }),
		);
		writeFile("packages/a/src/local.ts", "export const value = true;\n");
		writeFile("packages/b/package.json", JSON.stringify({ name: "b" }));
		writeFile("packages/b/src/app.ts", 'import { value } from "#only-a";\nvalue();\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toHaveLength(1);
		expect(diags[0].filePath).toBe("packages/b/src/app.ts");
	});

	it("does not use an out-of-root Vite alias replacement as evidence", async () => {
		const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-vite-outside-"));
		try {
			writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
			writeFile(
				"vite.config.ts",
				`import path from "node:path"; export default { resolve: { alias: { ghost: path.resolve(${JSON.stringify(
					outsideDir,
				)}) } } };\n`,
			);
			writeFile("src/app.ts", 'import value from "ghost/value";\nvalue();\n');

			const diags = await detectHallucinatedImports(buildContext());

			expect(diags).toHaveLength(1);
			expect(diags[0].message).toContain("ghost");
		} finally {
			fs.rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	it("does not use an out-of-root package imports target as evidence", async () => {
		writeFile(
			"package.json",
			JSON.stringify({
				name: "app",
				dependencies: {},
				imports: { "#external": "/tmp/outside-module.js" },
			}),
		);
		writeFile("src/app.ts", 'import value from "#external";\nvalue();\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("#external");
	});

	it.runIf(process.platform !== "win32")(
		"does not trust a nested package manifest symlink",
		async () => {
			const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-package-outside-"));
			try {
				writeFile("package.json", JSON.stringify({ name: "root", dependencies: {} }));
				writeFile("web/src/app.ts", 'import value from "ghost-package";\nvalue();\n');
				fs.writeFileSync(
					path.join(outsideDir, "package.json"),
					JSON.stringify({ name: "web", dependencies: { "ghost-package": "1.0.0" } }),
				);
				fs.symlinkSync(
					path.join(outsideDir, "package.json"),
					path.join(tmpDir, "web/package.json"),
				);

				const diags = await detectHallucinatedImports(buildContext());

				expect(diags).toHaveLength(1);
				expect(diags[0].message).toContain("ghost-package");
			} finally {
				fs.rmSync(outsideDir, { recursive: true, force: true });
			}
		},
	);

	it("does not treat module augmentation as ambient module evidence", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
		writeFile("src/augment.d.ts", 'export {}; declare module "ghost-module" {}\n');
		writeFile("src/app.ts", 'import value from "ghost-module";\nvalue();\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("ghost-module");
	});

	it("uses generated ambient declarations as compiler evidence", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: {} }));
		writeFile("generated/virtual.d.ts", 'declare module "generated:virtual";\n');
		writeFile("src/app.ts", 'import value from "generated:virtual";\nvalue();\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toEqual([]);
	});

	it("shares exported ambient types only with packages that opt into them", async () => {
		writeFile(
			"package.json",
			JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: {} }),
		);
		writeFile(
			"packages/plugin/package.json",
			JSON.stringify({
				name: "@scope/plugin",
				exports: { "./modules": "./src/modules.d.ts" },
			}),
		);
		writeFile("packages/plugin/src/modules.d.ts", 'declare module "plugin:virtual";\n');
		writeFile("packages/consumer/package.json", JSON.stringify({ name: "consumer" }));
		writeFile(
			"packages/consumer/tsconfig.json",
			JSON.stringify({ compilerOptions: { types: ["@scope/plugin/modules"] } }),
		);
		writeFile("packages/consumer/src/app.ts", 'import value from "plugin:virtual";\nvalue();\n');
		writeFile("packages/unrelated/package.json", JSON.stringify({ name: "unrelated" }));
		writeFile("packages/unrelated/src/app.ts", 'import value from "plugin:virtual";\nvalue();\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toHaveLength(1);
		expect(diags[0].filePath).toBe("packages/unrelated/src/app.ts");
	});

	it("does not read alias evidence from workspace entries outside the scan root", async () => {
		const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-hi-outside-workspace-"));
		try {
			fs.writeFileSync(
				path.join(outsideDir, "package.json"),
				JSON.stringify({ name: "outside", dependencies: { "totally-fake-package": "1.0.0" } }),
			);
			writeFile(
				"package.json",
				JSON.stringify({ name: "app", workspaces: [outsideDir], dependencies: {} }),
			);
			writeFile("src/app.ts", 'import { value } from "totally-fake-package";\nvalue();\n');

			const diags = await detectHallucinatedImports(buildContext());

			expect(diags).toHaveLength(1);
			expect(diags[0].message).toContain("totally-fake-package");
		} finally {
			fs.rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	it("ignores invalid bare package imports-map keys", async () => {
		writeFile(
			"package.json",
			JSON.stringify({
				name: "app",
				dependencies: {},
				imports: { "totally-fake-package": "./src/local.ts" },
			}),
		);
		writeFile("src/app.ts", 'import { value } from "totally-fake-package";\nvalue();\n');

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("totally-fake-package");
	});

	it("accepts local Python modules resolved from an ancestor source root", async () => {
		writeFile("requirements.txt", "pytest==9.0.0\n");
		writeFile("archive/v1/src/pose/__init__.py", "def estimate():\n    return None\n");
		writeFile(
			"archive/v1/src/api/main.py",
			"from src.pose import estimate\n\ndef run():\n    return estimate()\n",
		);

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toEqual([]);
	});

	it("does not treat an extensionless file as a local Python module", async () => {
		writeFile("requirements.txt", "pytest==9.0.0\n");
		writeFile("src/helper", "not a Python module\n");
		writeFile("src/main.py", "import helper\n");

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("helper");
	});

	it.runIf(process.platform !== "win32")(
		"does not treat a symlink to an external file as a local Python module",
		async () => {
			const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-hi-python-link-"));
			try {
				fs.writeFileSync(path.join(outsideDir, "helper.py"), "value = True\n");
				writeFile("requirements.txt", "pytest==9.0.0\n");
				writeFile("src/main.py", "import helper\n");
				fs.symlinkSync(path.join(outsideDir, "helper.py"), path.join(tmpDir, "src/helper.py"));

				const diags = await detectHallucinatedImports(buildContext());

				expect(diags).toHaveLength(1);
				expect(diags[0].message).toContain("helper");
			} finally {
				fs.rmSync(outsideDir, { recursive: true, force: true });
			}
		},
	);

	it("still flags a truly undeclared Python package", async () => {
		writeFile("requirements.txt", "pytest==9.0.0\n");
		writeFile("src/app.py", "from totally_fake_python_package_xyz import run\nrun()\n");

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("totally_fake_python_package_xyz");
	});

	it("still flags a truly undeclared package in a nested web package", async () => {
		writeFile("package.json", JSON.stringify({ name: "root", dependencies: {} }));
		writeFile(
			"web/package.json",
			JSON.stringify({ name: "web", dependencies: { "@docusaurus/core": "~3.10.1" } }),
		);
		writeFile("web/src/app.ts", `import { x } from "totally-fake-package-xyz";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("totally-fake-package-xyz");
	});

	it("still flags wasp imports outside a wasp project", async () => {
		writeFile("package.json", JSON.stringify({ name: "app", dependencies: { react: "^19.0.0" } }));
		writeFile("src/App.tsx", `import { useAuth } from "wasp/client/auth";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("wasp");
	});

	it("still flags @docusaurus virtual imports when docusaurus is not installed", async () => {
		writeFile("package.json", JSON.stringify({ name: "site", dependencies: { react: "^19.0.0" } }));
		writeFile("src/Link.tsx", `import Link from "@docusaurus/Link";\n`);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("@docusaurus/Link");
	});

	it("still flags real imports at file top level while ignoring template literal samples", async () => {
		writeFile("package.json", JSON.stringify({ name: "docs", dependencies: { react: "^19.0.0" } }));
		writeFile(
			"src/Hero.jsx",
			[
				`import { fake } from "real-hallucination-pkg";`,
				`const snippet = {`,
				`  source: \`import { getTasks } from "wasp/client/operations";\``,
				`};`,
				``,
			].join("\n"),
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("real-hallucination-pkg");
	});

	it("ignores dynamic import examples inside ordinary strings", async () => {
		writeFile("package.json", JSON.stringify({ name: "docs", dependencies: {} }));
		writeFile(
			"src/examples.js",
			[
				`const commonJs = "require('ghost-require')";`,
				`const esm = "import('ghost-dynamic')";`,
				`export { commonJs, esm };`,
			].join("\n"),
		);

		const diags = await detectHallucinatedImports(buildContext());

		expect(diags).toEqual([]);
	});

	it("skips generator templates via non-production path", async () => {
		writeFile("package.json", JSON.stringify({ name: "root", dependencies: {} }));
		writeFile(
			"waspc/data/Generator/templates/sdk/app.ts",
			`import express from "express";\nimport { x } from "wasp/client/auth";\n`,
		);
		const diags = await detectHallucinatedImports(buildContext());
		expect(diags).toEqual([]);
	});
});
