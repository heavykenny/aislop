import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod/v4";

const PackageManifestSchema = z.object({
	bin: z.record(z.string(), z.string()),
	scripts: z.record(z.string(), z.string()),
});

const WorkflowStepSchema = z.object({
	env: z.record(z.string(), z.string()).optional(),
	name: z.string().optional(),
	run: z.string().optional(),
	uses: z.string().optional(),
	with: z.record(z.string(), z.unknown()).optional(),
});

const WorkflowJobSchema = z.object({
	permissions: z.record(z.string(), z.string()),
	steps: z.array(WorkflowStepSchema),
});

const ReleaseWorkflowSchema = z.object({
	jobs: z.object({
		"move-major-tag": WorkflowJobSchema,
		"publish-gpr": WorkflowJobSchema,
		"publish-npm": WorkflowJobSchema,
	}),
	permissions: z.record(z.string(), z.string()),
});

describe("package release security", () => {
	it("keeps optional tool downloads out of dependency lifecycle scripts", () => {
		const manifest = PackageManifestSchema.parse(
			JSON.parse(fs.readFileSync("package.json", "utf8")),
		);

		expect(manifest.scripts.postinstall).toBeUndefined();
		expect(manifest.bin).toEqual({
			aislop: "dist/cli.js",
			"aislop-mcp": "dist/mcp.js",
			"aislop-tools": "scripts/install-tools.mjs",
		});
	});

	it("publishes to npm through a least-privilege OIDC job", () => {
		const workflowSource = fs.readFileSync(".github/workflows/release.yml", "utf8");
		const workflow = ReleaseWorkflowSchema.parse(parseYaml(workflowSource));
		const npmJob = workflow.jobs["publish-npm"];
		const setupNode = npmJob.steps.find((step) => step.uses?.startsWith("actions/setup-node@"));
		const publish = npmJob.steps.find((step) => step.name === "Publish to npm");

		expect(workflow.permissions).toEqual({ contents: "read" });
		expect(npmJob.permissions).toEqual({ contents: "read", "id-token": "write" });
		expect(setupNode?.with).toMatchObject({
			"node-version": 24,
			"package-manager-cache": false,
		});
		expect(publish?.run).toBe("npm publish --access public");
		expect(publish?.env).toBeUndefined();
		expect(workflowSource).not.toContain("secrets.NPM_TOKEN");
		expect(workflow.jobs["publish-gpr"].permissions).toEqual({
			contents: "read",
			packages: "write",
		});
		expect(workflow.jobs["move-major-tag"].permissions).toEqual({ contents: "write" });
	});
});
