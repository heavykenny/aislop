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
	if: z.string().optional(),
	name: z.string().optional(),
	run: z.string().optional(),
	shell: z.string().optional(),
	uses: z.string().optional(),
	with: z.record(z.string(), z.unknown()).optional(),
});

const WorkflowJobSchema = z.object({
	if: z.string().optional(),
	needs: z.union([z.string(), z.array(z.string())]).optional(),
	outputs: z.record(z.string(), z.string()).optional(),
	permissions: z.record(z.string(), z.string()),
	steps: z.array(WorkflowStepSchema),
});

const ReleaseWorkflowSchema = z.object({
	on: z.object({
		release: z.object({
			types: z.array(z.string()),
		}),
		workflow_dispatch: z.object({
			inputs: z.object({
				"move-major-tag": z.object({
					default: z.boolean(),
					required: z.boolean(),
					type: z.literal("boolean"),
				}),
				publish: z.object({
					default: z.boolean(),
					required: z.boolean(),
					type: z.literal("boolean"),
				}),
				tag: z.object({
					required: z.boolean(),
					type: z.literal("string"),
				}),
			}),
		}),
	}),
	jobs: z.object({
		"move-major-tag": WorkflowJobSchema,
		"publish-gpr": WorkflowJobSchema,
		"publish-npm": WorkflowJobSchema,
		"resolve-release": WorkflowJobSchema,
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
		const installNpm = npmJob.steps.find((step) => step.name === "Install npm 12");
		const publish = npmJob.steps.find((step) => step.name === "Publish to npm");

		expect(workflow.permissions).toEqual({ contents: "read" });
		expect(npmJob.permissions).toEqual({ contents: "read", "id-token": "write" });
		expect(setupNode?.with).toMatchObject({
			"node-version": 24,
			"package-manager-cache": false,
		});
		expect(installNpm?.run).toBe("npm install --global npm@12.0.1");
		expect(publish?.run).toBe("npm publish --access public");
		expect(publish?.env).toBeUndefined();
		expect(workflowSource).not.toContain("secrets.NPM_TOKEN");
		expect(workflow.jobs["publish-gpr"].permissions).toEqual({
			contents: "read",
			packages: "write",
		});
		expect(workflow.jobs["move-major-tag"].permissions).toEqual({ contents: "write" });
	});

	it("resolves an existing GitHub release before executing its code", () => {
		const workflow = ReleaseWorkflowSchema.parse(
			parseYaml(fs.readFileSync(".github/workflows/release.yml", "utf8")),
		);
		const resolveJob = workflow.jobs["resolve-release"];
		const resolveStep = resolveJob.steps.find((step) => step.name === "Resolve release");
		const resolvedSha = "${{ needs.resolve-release.outputs.sha }}";
		const checkoutRefs = [
			workflow.jobs["publish-npm"],
			workflow.jobs["publish-gpr"],
			workflow.jobs["move-major-tag"],
		].map((job) => job.steps.find((step) => step.uses?.startsWith("actions/checkout@"))?.with?.ref);

		expect(resolveJob.permissions).toEqual({ contents: "read" });
		expect(resolveJob.outputs).toEqual({
			prerelease: "${{ steps.release.outputs.prerelease }}",
			sha: "${{ steps.release.outputs.sha }}",
			tag: "${{ steps.release.outputs.tag }}",
		});
		expect(resolveJob.steps.some((step) => step.uses?.startsWith("actions/checkout@"))).toBe(false);
		expect(resolveStep?.env).toEqual({
			GH_TOKEN: "${{ github.token }}",
			RELEASE_TAG: "${{ github.event.release.tag_name || inputs.tag }}",
		});
		expect(resolveStep?.run).toContain(
			'[[ "$RELEASE_TAG" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]',
		);
		expect(resolveStep?.run).toContain(
			'gh api "repos/$GITHUB_REPOSITORY/releases/tags/$RELEASE_TAG"',
		);
		expect(resolveStep?.run).toContain("[.draft, .prerelease, .published_at] | @tsv");
		expect(resolveStep?.run).toContain('if [ "$draft" != "false" ]');
		expect(resolveStep?.run).toContain('[ "$published_at" = "null" ]');
		expect(resolveStep?.run).toContain(
			'gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$RELEASE_TAG"',
		);
		expect(resolveStep?.run).toContain('if [ "$object_type" != "commit" ]');
		expect(checkoutRefs).toEqual([resolvedSha, resolvedSha, resolvedSha]);
		expect(workflow.jobs["publish-npm"].needs).toBe("resolve-release");
		expect(workflow.jobs["publish-gpr"].needs).toEqual(["resolve-release", "publish-npm"]);
		expect(workflow.jobs["move-major-tag"].needs).toEqual(["resolve-release", "publish-npm"]);
	});

	it("keeps manual recovery non-publishing unless explicitly enabled", () => {
		const workflow = ReleaseWorkflowSchema.parse(
			parseYaml(fs.readFileSync(".github/workflows/release.yml", "utf8")),
		);
		const npmJob = workflow.jobs["publish-npm"];
		const verifyTag = npmJob.steps.find((step) => step.name === "Verify release tag");
		const verifyTrust = npmJob.steps.find((step) => step.name === "Verify npm trusted publishing");
		const publish = npmJob.steps.find((step) => step.name === "Publish to npm");
		const publishCondition = "${{ github.event_name == 'release' || inputs.publish }}";
		const stableRelease = "needs.resolve-release.outputs.prerelease == 'false'";
		const expressionStart = "${{";
		const moveMajorCondition = workflow.jobs["move-major-tag"].if?.replace(/\s+/g, " ").trim();

		expect(workflow.on.release.types).toEqual(["published"]);
		expect(workflow.on.workflow_dispatch.inputs.tag).toMatchObject({
			required: true,
			type: "string",
		});
		expect(workflow.on.workflow_dispatch.inputs["move-major-tag"]).toEqual({
			default: false,
			required: true,
			type: "boolean",
		});
		expect(workflow.on.workflow_dispatch.inputs.publish).toEqual({
			default: false,
			required: true,
			type: "boolean",
		});
		expect(verifyTag?.env).toEqual({ RELEASE_TAG: "${{ needs.resolve-release.outputs.tag }}" });
		expect(verifyTag?.run).toContain('expected_tag="v$(node -p');
		expect(verifyTag?.run).toContain('if [ "$RELEASE_TAG" != "$expected_tag" ]');
		expect(verifyTrust?.shell).toBe("bash");
		expect(verifyTrust?.run).toContain("npm publish --access public --dry-run --loglevel verbose");
		expect(verifyTrust?.run).toContain('grep -Fq "Successfully retrieved and set token"');
		expect(publish?.if).toBe(publishCondition);
		expect(workflow.jobs["publish-gpr"].if).toBe(publishCondition);
		expect(moveMajorCondition).toBe(
			`${expressionStart} (github.event_name == 'release' && ${stableRelease}) || ` +
				`(github.event_name == 'workflow_dispatch' && inputs.publish && ` +
				`inputs['move-major-tag'] && ${stableRelease}) }}`,
		);
	});
});
