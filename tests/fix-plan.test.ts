import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixCommand } from "../src/commands/fix.js";
import { buildFixPlan, buildFixStepNames } from "../src/commands/fix-plan.js";
import { NO_CHANGES_APPLIED } from "../src/commands/fix-render.js";
import { runOneFixStep } from "../src/commands/fix-steps.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { AislopConfig } from "../src/config/index.js";
import type { Diagnostic } from "../src/engines/types.js";
import type { ProjectInfo } from "../src/utils/discover.js";

const makeProjectInfo = (overrides: Partial<ProjectInfo> = {}): ProjectInfo => ({
	name: "test-project",
	languages: ["typescript"],
	frameworks: ["none"],
	installedTools: {},
	sourceFileCount: 10,
	...overrides,
});

describe("buildFixStepNames", () => {
	it("includes JS/TS steps for typescript projects", () => {
		const steps = buildFixStepNames(makeProjectInfo(), DEFAULT_CONFIG, {});
		expect(steps).toContain("Unused imports");
		expect(steps).toContain("Dead code & comments");
		expect(steps).toContain("Lint fixes (js/ts)");
		expect(steps).toContain("Unused dependencies");
		expect(steps).toContain("Formatting (js/ts)");
	});

	it("includes Python steps when ruff is installed", () => {
		const steps = buildFixStepNames(
			makeProjectInfo({ languages: ["python"], installedTools: { ruff: true } }),
			DEFAULT_CONFIG,
			{},
		);
		expect(steps).toContain("Lint fixes (python)");
		expect(steps).toContain("Formatting (python)");
		expect(steps).not.toContain("Lint fixes (js/ts)");
	});

	it("skips Python lint/format when ruff is not installed", () => {
		const steps = buildFixStepNames(
			makeProjectInfo({ languages: ["python"], installedTools: {} }),
			DEFAULT_CONFIG,
			{},
		);
		expect(steps).not.toContain("Lint fixes (python)");
		expect(steps).not.toContain("Formatting (python)");
	});

	it("includes Go formatting when gofmt is installed", () => {
		const steps = buildFixStepNames(
			makeProjectInfo({ languages: ["go"], installedTools: { gofmt: true } }),
			DEFAULT_CONFIG,
			{},
		);
		expect(steps).toContain("Formatting (go)");
	});

	it("includes Ruby lint and formatting when rubocop is installed", () => {
		const steps = buildFixStepNames(
			makeProjectInfo({ languages: ["ruby"], installedTools: { rubocop: true } }),
			DEFAULT_CONFIG,
			{},
		);
		expect(steps).toContain("Lint fixes (ruby)");
		expect(steps).toContain("Formatting (ruby)");
	});

	it("includes Rust formatting when rustfmt is installed", () => {
		const steps = buildFixStepNames(
			makeProjectInfo({ languages: ["rust"], installedTools: { rustfmt: true } }),
			DEFAULT_CONFIG,
			{},
		);
		expect(steps).toContain("Formatting (rust)");
	});

	it("includes PHP formatting when php-cs-fixer is installed", () => {
		const steps = buildFixStepNames(
			makeProjectInfo({ languages: ["php"], installedTools: { "php-cs-fixer": true } }),
			DEFAULT_CONFIG,
			{},
		);
		expect(steps).toContain("Formatting (php)");
	});

	it("does not include force steps without force flag", () => {
		const steps = buildFixStepNames(makeProjectInfo(), DEFAULT_CONFIG, {});
		expect(steps).not.toContain("Remove unused files");
		expect(steps).not.toContain("Dependency audit fixes");
	});

	it("includes force steps with force flag", () => {
		const steps = buildFixStepNames(makeProjectInfo(), DEFAULT_CONFIG, { force: true });
		expect(steps).toContain("Remove unused files");
		expect(steps).toContain("Dependency audit fixes");
	});

	it("skips Expo step by default even when framework is expo and force is on", () => {
		const steps = buildFixStepNames(makeProjectInfo({ frameworks: ["expo"] }), DEFAULT_CONFIG, {
			force: true,
		});
		expect(steps).not.toContain("Expo dependency alignment");
	});

	it("includes Expo step only when Expo Doctor is explicitly enabled", () => {
		const config: AislopConfig = {
			...DEFAULT_CONFIG,
			lint: { ...DEFAULT_CONFIG.lint, expoDoctor: true },
		};
		const steps = buildFixStepNames(makeProjectInfo({ frameworks: ["expo"] }), config, {
			force: true,
		});
		expect(steps).toContain("Expo dependency alignment");
	});

	it("respects disabled engines in config", () => {
		const config: AislopConfig = {
			...DEFAULT_CONFIG,
			engines: { ...DEFAULT_CONFIG.engines, lint: false, format: false },
		};
		const steps = buildFixStepNames(makeProjectInfo(), config, {});
		expect(steps).not.toContain("Lint fixes (js/ts)");
		expect(steps).not.toContain("Formatting (js/ts)");
		// ai-slop steps should still be there
		expect(steps).toContain("Unused imports");
	});

	it("returns empty array when all engines are disabled", () => {
		const config: AislopConfig = {
			...DEFAULT_CONFIG,
			engines: {
				format: false,
				lint: false,
				"code-quality": false,
				"ai-slop": false,
				architecture: false,
				security: false,
			},
		};
		const steps = buildFixStepNames(makeProjectInfo(), config, {});
		expect(steps).toHaveLength(0);
	});

	it("includes duplicate-import and unused-declaration steps for JS/TS projects", () => {
		const steps = buildFixStepNames(makeProjectInfo(), DEFAULT_CONFIG, {});
		expect(steps).toContain("Duplicate imports");
		expect(steps).toContain("Unused declarations");
	});

	it("marks safe-incompatible steps as skipped by --safe", () => {
		const plan = buildFixPlan(makeProjectInfo(), DEFAULT_CONFIG, { safe: true });
		expect(plan.find((step) => step.name === "Narrative comments")?.status).toBe("planned");
		expect(plan.find((step) => step.name === "Dead code & comments")).toMatchObject({
			status: "skipped",
			reason: "skipped by --safe",
		});
		expect(plan.find((step) => step.name === "Unused declarations")).toMatchObject({
			status: "skipped",
			reason: "skipped by --safe",
		});
		expect(plan.find((step) => step.name === "Lint fixes (js/ts)")).toMatchObject({
			status: "skipped",
			reason: "skipped by --safe",
		});
		expect(plan.find((step) => step.name === "Unused dependencies")).toMatchObject({
			status: "skipped",
			reason: "skipped by --safe",
		});
		expect(buildFixStepNames(makeProjectInfo(), DEFAULT_CONFIG, { safe: true })).not.toContain(
			"Dead code & comments",
		);
	});

	it("reports aggressive steps as skipped by --safe when both flags are set", () => {
		const plan = buildFixPlan(makeProjectInfo(), DEFAULT_CONFIG, { safe: true, force: true });
		expect(plan.find((step) => step.name === "Remove unused files")).toMatchObject({
			status: "skipped",
			reason: "skipped by --safe",
		});
		expect(plan.find((step) => step.name === "Dependency audit fixes")).toMatchObject({
			status: "skipped",
			reason: "skipped by --safe",
		});
		expect(
			buildFixStepNames(makeProjectInfo(), DEFAULT_CONFIG, { safe: true, force: true }),
		).not.toContain("Remove unused files");
	});

	it("marks engine-gated steps as disabled in config", () => {
		const config: AislopConfig = {
			...DEFAULT_CONFIG,
			engines: { ...DEFAULT_CONFIG.engines, lint: false, format: false },
		};
		const plan = buildFixPlan(makeProjectInfo(), config, {});
		expect(plan.find((step) => step.name === "Lint fixes (js/ts)")).toMatchObject({
			status: "skipped",
			reason: "disabled in config",
		});
		expect(plan.find((step) => step.name === "Formatting (js/ts)")).toMatchObject({
			status: "skipped",
			reason: "disabled in config",
		});
	});
});

const git = (cwd: string, args: string[]) => {
	execFileSync("git", args, { cwd, stdio: "ignore" });
};

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

const gitStatus = (root: string): string =>
	execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: root, encoding: "utf-8" });

const snapshot = (root: string) => ({ tree: posixTree(root), status: gitStatus(root) });

const previewConfig = (): AislopConfig => ({
	...DEFAULT_CONFIG,
	engines: {
		...DEFAULT_CONFIG.engines,
		format: false,
		lint: false,
		"code-quality": false,
		architecture: false,
		security: false,
		"ai-slop": true,
	},
	telemetry: { enabled: false },
});

const UNUSED = 'import { leftover } from "./missing";\nexport const value = 1;\n';
const UNTRACKED = "untracked leftover that must not be touched\n";

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

const initPreviewRepo = (): string => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-fix-dry-run-"));
	git(root, ["init"]);
	git(root, ["config", "user.email", "test@example.com"]);
	git(root, ["config", "user.name", "test"]);
	git(root, ["config", "commit.gpgsign", "false"]);
	write(root, "src/app.ts", UNUSED);
	git(root, ["add", "src/app.ts"]);
	git(root, ["commit", "-m", "init", "--no-verify"]);
	write(root, "notes.txt", UNTRACKED);
	return root;
};

describe("runOneFixStep dry-run", () => {
	it("never invokes the mutating fixer", async () => {
		let applied = 0;
		const finding: Diagnostic = {
			filePath: "src/app.ts",
			engine: "ai-slop",
			rule: "ai-slop/unused-import",
			severity: "warning",
			message: "unused",
			help: "",
			line: 1,
			column: 1,
			category: "Imports",
			fixable: true,
		};
		const result = await runOneFixStep(
			"Unused imports",
			async () => [finding],
			async () => {
				applied += 1;
			},
			{ dryRun: true },
		);
		expect(applied).toBe(0);
		expect(result.resolvedIssues).toBe(0);
		expect(result.beforeIssues).toBe(1);
		expect(result.beforeFiles).toBe(1);
	});
});

describe("fix --dry-run", () => {
	const repos: string[] = [];

	afterEach(() => {
		for (const root of repos.splice(0)) {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("prints the plan and does not modify tracked, untracked, or git status", async () => {
		const root = initPreviewRepo();
		repos.push(root);
		const before = snapshot(root);

		const output = await captureStdout(() =>
			fixCommand(root, previewConfig(), { verbose: false, dryRun: true, showHeader: true }),
		);

		expect(output).toContain("Fix plan");
		expect(output).toContain("Unused imports");
		expect(output).toMatch(/1 finding/);
		expect(output).toContain(NO_CHANGES_APPLIED);
		expect(snapshot(root)).toEqual(before);
	});

	it("is deterministic on an unchanged repository", async () => {
		const root = initPreviewRepo();
		repos.push(root);
		const run = () =>
			captureStdout(() =>
				fixCommand(root, previewConfig(), { verbose: false, dryRun: true, showHeader: true }),
			);
		const first = await run();
		const second = await run();
		expect(second).toBe(first);
	});

	it("leaves the unused import in place so a later applying run can still fix it", async () => {
		const root = initPreviewRepo();
		repos.push(root);
		await captureStdout(() =>
			fixCommand(root, previewConfig(), { verbose: false, dryRun: true, showHeader: false }),
		);
		expect(fs.readFileSync(path.join(root, "src/app.ts"), "utf-8")).toBe(UNUSED);
		await captureStdout(() =>
			fixCommand(root, previewConfig(), { verbose: false, dryRun: false, showHeader: false }),
		);
		expect(fs.readFileSync(path.join(root, "src/app.ts"), "utf-8")).not.toBe(UNUSED);
		expect(fs.readFileSync(path.join(root, "notes.txt"), "utf-8")).toBe(UNTRACKED);
	});
});
