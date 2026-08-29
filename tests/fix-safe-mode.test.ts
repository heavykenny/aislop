import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixCommand } from "../src/commands/fix.js";
import type { PipelineDeps } from "../src/commands/fix-pipeline.js";
import { runAiSlopSteps, runFormattingStep } from "../src/commands/fix-pipeline.js";
import { NO_CHANGES_APPLIED } from "../src/commands/fix-render.js";
import type { FixStepResult } from "../src/commands/fix-steps.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { AislopConfig } from "../src/config/index.js";

const recordingDeps = (
	safe: boolean,
	overrides: Partial<PipelineDeps> = {},
): { deps: PipelineDeps; steps: string[] } => {
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
		projectInfo: { languages: ["typescript"], installedTools: {} } as PipelineDeps["projectInfo"],
		force: false,
		safe,
		runStep,
		...overrides,
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

describe("runFormattingStep safe mode", () => {
	it("skips Ruby and PHP formatters in safe mode", async () => {
		const { deps, steps } = recordingDeps(true, {
			config: { engines: { format: true } } as unknown as AislopConfig,
			projectInfo: {
				languages: ["ruby", "php"],
				installedTools: { rubocop: true, "php-cs-fixer": true },
			} as PipelineDeps["projectInfo"],
		});

		await runFormattingStep(deps);

		expect(steps).toEqual([]);
	});

	it("keeps Ruby and PHP formatters enabled outside safe mode", async () => {
		const { deps, steps } = recordingDeps(false, {
			config: { engines: { format: true } } as unknown as AislopConfig,
			projectInfo: {
				languages: ["ruby", "php"],
				installedTools: { rubocop: true, "php-cs-fixer": true },
			} as PipelineDeps["projectInfo"],
		});

		await runFormattingStep(deps);

		expect(steps).toEqual(["Formatting (ruby)", "Formatting (php)"]);
	});
});

const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });

const write = (root: string, rel: string, body: string) => {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, body, "utf-8");
};

const posixTree = (root: string): Record<string, string> => {
	const files: Record<string, string> = {};
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === ".git") continue;
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(abs);
				continue;
			}
			files[path.relative(root, abs).split(path.sep).join("/")] = fs.readFileSync(abs, "utf-8");
		}
	};
	walk(root);
	return files;
};

const captureStdout = async (run: () => Promise<unknown>): Promise<string> => {
	const chunks: string[] = [];
	const original = process.stdout.write.bind(process.stdout);
	const previousCi = process.env.CI;
	process.env.CI = "1";
	process.stdout.write = ((chunk: unknown) => {
		chunks.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	try {
		await run();
		return chunks.join("");
	} finally {
		process.stdout.write = original;
		if (previousCi === undefined) delete process.env.CI;
		else process.env.CI = previousCi;
	}
};

describe("fix --dry-run --safe", () => {
	let root = "";

	afterEach(() => {
		if (root) fs.rmSync(root, { recursive: true, force: true });
	});

	it("lists steps skipped by --safe and does not write files", async () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-fix-safe-dry-run-"));
		git(root, ["init"]);
		git(root, ["config", "user.email", "test@example.com"]);
		git(root, ["config", "user.name", "test"]);
		git(root, ["config", "commit.gpgsign", "false"]);
		write(root, "src/app.ts", 'import { leftover } from "./missing";\nexport const value = 1;\n');
		git(root, ["add", "."]);
		git(root, ["commit", "-m", "init", "--no-verify"]);
		const before = posixTree(root);
		const statusBefore = execFileSync("git", ["status", "--porcelain", "-uall"], {
			cwd: root,
			encoding: "utf-8",
		});

		const config: AislopConfig = {
			...DEFAULT_CONFIG,
			telemetry: { enabled: false },
		};
		const output = await captureStdout(() =>
			fixCommand(root, config, { verbose: false, dryRun: true, safe: true, showHeader: true }),
		);

		expect(output).toContain("Fix plan");
		expect(output).toContain("skipped by --safe");
		expect(output).toContain("Dead code & comments");
		expect(output).toContain("Unused declarations");
		expect(output).toContain("Lint fixes (js/ts)");
		expect(output).toContain(NO_CHANGES_APPLIED);
		expect(posixTree(root)).toEqual(before);
		expect(
			execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: root, encoding: "utf-8" }),
		).toBe(statusBefore);
	});
});
