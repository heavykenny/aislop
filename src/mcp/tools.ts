import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import { findConfigDir, loadConfig, RULES_FILE } from "../config/index.js";
import { runEngines } from "../engines/orchestrator.js";
import type { Diagnostic, EngineContext, EngineName } from "../engines/types.js";
import { readBaseline } from "../hooks/quality-gate/baseline.js";
import { assessDiagnostic, summarizeFindingAssessments } from "../output/finding-assessment.js";
import { calculateScore } from "../scoring/index.js";
import { discoverProject } from "../utils/discover.js";

const MAX_FINDINGS = 25;

const resolveCwd = (raw: string | undefined): string => {
	if (!raw || raw.trim().length === 0) return process.cwd();
	return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
};

const buildEngineContext = (
	rootDirectory: string,
	project: Awaited<ReturnType<typeof discoverProject>>,
	config: ReturnType<typeof loadConfig>,
): EngineContext => {
	const configDir = findConfigDir(rootDirectory);
	const rulesPath = configDir ? path.join(configDir, RULES_FILE) : undefined;
	return {
		rootDirectory,
		languages: project.languages,
		frameworks: project.frameworks,
		installedTools: project.installedTools,
		config: {
			quality: config.quality,
			security: config.security,
			lint: config.lint,
			architectureRulesPath: config.engines.architecture ? rulesPath : undefined,
		},
	};
};

const enabledEnginesFromConfig = (
	config: ReturnType<typeof loadConfig>,
): Record<EngineName, boolean> => ({
	format: config.engines.format,
	lint: config.engines.lint,
	"code-quality": config.engines["code-quality"],
	"ai-slop": config.engines["ai-slop"],
	architecture: config.engines.architecture,
	security: config.engines.security,
});

const summariseDiagnostic = (d: Diagnostic, rootDirectory: string) => ({
	file: path.isAbsolute(d.filePath) ? path.relative(rootDirectory, d.filePath) : d.filePath,
	line: d.line,
	column: d.column,
	rule: d.rule,
	severity: d.severity,
	assessment: assessDiagnostic(d),
	message: d.message,
	fixable: d.fixable,
	help: d.help || undefined,
});

const summariseDiagnostics = (diagnostics: Diagnostic[], rootDirectory: string) => {
	const counts = {
		error: diagnostics.filter((d) => d.severity === "error").length,
		warning: diagnostics.filter((d) => d.severity === "warning").length,
		fixable: diagnostics.filter((d) => d.fixable).length,
		total: diagnostics.length,
	};
	const findings = diagnostics
		.slice(0, MAX_FINDINGS)
		.map((d) => summariseDiagnostic(d, rootDirectory));
	const elided = diagnostics.length > MAX_FINDINGS ? diagnostics.length - MAX_FINDINGS : 0;
	return { counts, findingAssessment: summarizeFindingAssessments(diagnostics), findings, elided };
};

const runScan = async (cwd: string) => {
	const project = await discoverProject(cwd);
	const config = loadConfig(cwd);
	const context = buildEngineContext(project.rootDirectory, project, config);
	const enabled = enabledEnginesFromConfig(config);
	const results = await runEngines(context, enabled);
	const diagnostics = results.flatMap((r) => r.diagnostics);
	const { score } = calculateScore(
		diagnostics,
		config.scoring.weights,
		config.scoring.thresholds,
		project.sourceFileCount,
		config.scoring.smoothing,
		config.scoring.maxPerRule,
	);
	const errorCount = diagnostics.filter((d) => d.severity === "error").length;
	const failBelow = config.ci.failBelow;
	return {
		project,
		diagnostics,
		score,
		qualityGate: {
			failBelow,
			passed: errorCount === 0 && score >= failBelow,
			errorCount,
		},
	};
};

export const aislopScanInputSchema = z.object({
	path: z
		.string()
		.optional()
		.describe("Project directory to scan. Defaults to the MCP server's cwd."),
});

export const aislopScanTool = {
	name: "aislop_scan",
	description:
		"Scan a project with aislop. Runs the deterministic engines (format, lint, code-quality, ai-slop, security, architecture), returns a 0–100 score and the top findings. Use this before deciding whether the agent's recent changes are ready to ship.",
	inputSchema: aislopScanInputSchema,
};

export const handleAislopScan = async (input: z.infer<typeof aislopScanInputSchema>) => {
	const cwd = resolveCwd(input.path);
	const { project, diagnostics, score, qualityGate } = await runScan(cwd);
	const summary = summariseDiagnostics(diagnostics, project.rootDirectory);
	return {
		score,
		qualityGate,
		fileCount: project.sourceFileCount,
		languages: project.languages,
		frameworks: project.frameworks,
		...summary,
	};
};

export const aislopFixInputSchema = z.object({
	path: z
		.string()
		.optional()
		.describe("Project directory to fix. Defaults to the MCP server's cwd."),
	force: z
		.boolean()
		.optional()
		.describe(
			"Run aggressive fixes (dependency audit overrides, unused-file removal, framework alignment). Off by default; on means writes to package.json and may delete files.",
		),
});

interface SpawnOk {
	exitCode: number;
	stdout: string;
	stderr: string;
}

const runAislopFix = (cwd: string, force: boolean): Promise<SpawnOk> => {
	const args = ["fix"];
	if (force) args.push("--force");
	return new Promise((resolve) => {
		// spawn() args bypass the shell — no injection surface. We hardcode "latest" anyway.
		const child = spawn("npx", ["--yes", "aislop@latest", ...args], {
			cwd,
			env: { ...process.env, NO_COLOR: "1" },
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout?.on("data", (b) => stdout.push(b as Buffer));
		child.stderr?.on("data", (b) => stderr.push(b as Buffer));
		child.on("close", (code) =>
			resolve({
				exitCode: code ?? 0,
				stdout: Buffer.concat(stdout).toString("utf-8"),
				stderr: Buffer.concat(stderr).toString("utf-8"),
			}),
		);
	});
};

export const aislopFixTool = {
	name: "aislop_fix",
	description:
		"Apply mechanical fixes (formatting, unused imports, narrative comments, duplicate imports, etc.). Returns counts before/after so the agent can see how many issues remain. Use BEFORE handing off to the agent — saves tokens by clearing what the CLI handles deterministically.",
	inputSchema: aislopFixInputSchema,
};

export const handleAislopFix = async (input: z.infer<typeof aislopFixInputSchema>) => {
	const cwd = resolveCwd(input.path);
	const before = await runScan(cwd);
	const fixResult = await runAislopFix(cwd, Boolean(input.force));
	const after = await runScan(cwd);

	const fixedCount = Math.max(0, before.diagnostics.length - after.diagnostics.length);
	const summary = summariseDiagnostics(after.diagnostics, after.project.rootDirectory);

	return {
		ok: fixResult.exitCode === 0,
		exitCode: fixResult.exitCode,
		fixed: fixedCount,
		scoreBefore: before.score,
		scoreAfter: after.score,
		delta: after.score - before.score,
		remaining: summary.counts.total,
		counts: summary.counts,
		findings: summary.findings,
		elided: summary.elided,
	};
};

export const aislopWhyInputSchema = z.object({
	rule_id: z
		.string()
		.describe(
			"Full rule id (e.g. `ai-slop/narrative-comment`, `complexity/function-too-long`, `security/sql-injection`).",
		),
});

export const aislopWhyTool = {
	name: "aislop_why",
	description:
		"Explain an aislop rule: what it catches, why an AI agent typically produces it, severity, and whether it's auto-fixable. Use when a finding's message alone isn't enough to act on.",
	inputSchema: aislopWhyInputSchema,
};

export const handleAislopWhy = (input: z.infer<typeof aislopWhyInputSchema>) => {
	const ruleId = input.rule_id.trim();
	const [engine, slug] = ruleId.split("/");
	const docs = slug ? `https://scanaislop.com/patterns#${slug}` : "https://scanaislop.com/patterns";
	return {
		id: ruleId,
		engine: engine ?? "unknown",
		docs,
		hint: "Run `aislop rules` for the full list of rules and their auto-fix status. The /patterns page has bad/good code examples for every named ai-slop pattern.",
	};
};

export const aislopBaselineInputSchema = z.object({
	path: z.string().optional().describe("Project directory. Defaults to the MCP server's cwd."),
});

export const aislopBaselineTool = {
	name: "aislop_baseline",
	description:
		"Read the project's baseline (the last captured score the per-edit hook compares against). Returns score / lastScanAt / fileCount, or null if no baseline exists yet (run `aislop hook baseline` to capture).",
	inputSchema: aislopBaselineInputSchema,
};

export const handleAislopBaseline = (input: z.infer<typeof aislopBaselineInputSchema>) => {
	const cwd = resolveCwd(input.path);
	const baseline = readBaseline(cwd);
	if (baseline) {
		return {
			exists: true,
			score: baseline.score,
			lastScanAt: baseline.updatedAt,
			fileCount: baseline.fileCount,
		};
	}
	return { exists: false, hint: "Run `aislop hook baseline` to capture a baseline." };
};
