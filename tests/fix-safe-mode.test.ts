import { describe, expect, it } from "vitest";
import type { PipelineDeps } from "../src/commands/fix-pipeline.js";
import { runAiSlopSteps } from "../src/commands/fix-pipeline.js";
import type { FixStepResult } from "../src/commands/fix-steps.js";
import type { AislopConfig } from "../src/config/index.js";

const recordingDeps = (safe: boolean): { deps: PipelineDeps; steps: string[] } => {
	const steps: string[] = [];
	const runStep: PipelineDeps["runStep"] = async (name) => {
		steps.push(name);
		const result: FixStepResult = {
			name,
			beforeIssues: 0,
			afterIssues: 0,
			resolvedIssues: 0,
			beforeFiles: 0,
			failed: false,
			elapsedMs: 0,
		};
		return result;
	};
	const deps = {
		rail: { start: () => {}, setActiveLabel: () => {} },
		context: {
			rootDirectory: "/tmp/none",
			languages: ["typescript"],
			frameworks: ["none"],
			files: [],
			installedTools: {},
			config: {} as PipelineDeps["context"]["config"],
		},
		config: { engines: { "ai-slop": true } } as unknown as AislopConfig,
		resolvedDir: "/tmp/none",
		projectInfo: { languages: ["typescript"] } as PipelineDeps["projectInfo"],
		force: false,
		safe,
		runStep,
	} as PipelineDeps;
	return { deps, steps };
};

describe("runAiSlopSteps safe mode", () => {
	it("runs only reversible steps and the narrative-comment step in safe mode", async () => {
		const { deps, steps } = recordingDeps(true);
		await runAiSlopSteps(deps);
		expect(steps).toEqual(["Unused imports", "Duplicate imports", "Narrative comments"]);
		expect(steps).not.toContain("Dead code & comments");
	});

	it("runs the combined dead-code-and-comments step in default mode", async () => {
		const { deps, steps } = recordingDeps(false);
		await runAiSlopSteps(deps);
		expect(steps).toEqual(["Unused imports", "Duplicate imports", "Dead code & comments"]);
		expect(steps).not.toContain("Narrative comments");
	});
});
