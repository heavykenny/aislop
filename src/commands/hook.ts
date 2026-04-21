import fs from "node:fs";
import os from "node:os";
import { runClaudeHook, runClaudeStopHook } from "../hooks/adapters/claude.js";
import { runCursorHook } from "../hooks/adapters/cursor.js";
import { runGeminiHook } from "../hooks/adapters/gemini.js";
import {
	AGENTS_PROJECT_ONLY,
	AGENTS_SUPPORTING_BOTH_SCOPES,
	ALL_AGENTS,
	type AgentName,
	defaultScopeFor,
	detectInstalledAgents,
	REGISTRY,
} from "../hooks/install/registry.js";
import type { HookInstallOpts } from "../hooks/install/types.js";
import { captureBaseline } from "../hooks/quality-gate/baseline.js";
import { isCancel, multiselect } from "../ui/prompts.js";
import { style, theme } from "../ui/theme.js";

const AGENT_LABELS: Record<AgentName, { label: string; hint: string }> = {
	claude: { label: "Claude Code", hint: "PostToolUse, runtime" },
	cursor: { label: "Cursor", hint: "afterFileEdit, runtime" },
	gemini: { label: "Gemini CLI", hint: "AfterTool, runtime" },
	codex: { label: "Codex CLI", hint: "rules-only" },
	windsurf: { label: "Windsurf", hint: "rules-only, project" },
	cline: { label: "Cline + Roo", hint: "rules-only, project" },
	kilocode: { label: "Kilo Code", hint: "rules-only, project" },
	antigravity: { label: "Antigravity", hint: "rules-only, project" },
	copilot: { label: "GitHub Copilot", hint: "rules-only, project" },
};

interface InstallFlags {
	agents: AgentName[];
	scope: "global" | "project";
	dryRun: boolean;
	yes: boolean;
	qualityGate: boolean;
}

const resolveOpts = (agent: AgentName, flags: InstallFlags): HookInstallOpts => {
	const scope: "global" | "project" = AGENTS_PROJECT_ONLY.includes(agent) ? "project" : flags.scope;
	return {
		home: os.homedir(),
		cwd: process.cwd(),
		scope,
		dryRun: flags.dryRun,
		qualityGate: flags.qualityGate,
	};
};

const printPlan = (
	agent: AgentName,
	result: { planned: { path: string; summary: string }[] },
): void => {
	if (result.planned.length === 0) {
		process.stdout.write(`  ${agent}: already up to date\n`);
		return;
	}
	process.stdout.write(`  ${agent}:\n`);
	for (const op of result.planned) {
		process.stdout.write(`    ${style(theme, "dim", "+")} ${op.path} — ${op.summary}\n`);
	}
};

export const hookInstall = async (flags: InstallFlags): Promise<void> => {
	if (flags.dryRun) {
		process.stdout.write("aislop hook install (dry-run)\n\n");
	}
	for (const agent of flags.agents) {
		const opts = resolveOpts(agent, flags);
		const result = REGISTRY[agent].install(opts);
		if (flags.dryRun) {
			printPlan(agent, result);
			continue;
		}
		if (result.wrote.length === 0) {
			process.stdout.write(`${agent}: nothing to do (already up to date)\n`);
			continue;
		}
		for (const f of result.wrote) process.stdout.write(`  wrote  ${f}\n`);
		for (const f of result.skipped) process.stdout.write(`  skip   ${f}\n`);
	}
	if (flags.dryRun) {
		process.stdout.write("\nNo files touched. Re-run without --dry-run to apply.\n");
	}
};

export const hookUninstall = async (flags: InstallFlags): Promise<void> => {
	if (flags.dryRun) {
		process.stdout.write("aislop hook uninstall (dry-run)\n\n");
	}
	for (const agent of flags.agents) {
		const opts = resolveOpts(agent, flags);
		const result = REGISTRY[agent].uninstall(opts);
		if (result.removed.length === 0) {
			process.stdout.write(`${agent}: nothing installed\n`);
			continue;
		}
		for (const f of result.removed) process.stdout.write(`  remove  ${f}\n`);
		for (const f of result.skipped) process.stdout.write(`  skip    ${f}\n`);
	}
};

export const hookStatus = async (): Promise<void> => {
	const home = os.homedir();
	const cwd = process.cwd();
	process.stdout.write("aislop hook status\n\n");
	const installed = new Set(detectInstalledAgents({ home, cwd }));
	for (const agent of ALL_AGENTS) {
		const scope = defaultScopeFor(agent);
		const targets = REGISTRY[agent].paths({ home, cwd, scope });
		const hits = targets.filter((p) => fs.existsSync(p));
		const status = installed.has(agent) ? "installed" : "not installed";
		const marker = installed.has(agent) ? "✓" : "·";
		process.stdout.write(`  ${marker} ${agent.padEnd(12)} ${scope.padEnd(8)} ${status}\n`);
		for (const p of hits) process.stdout.write(`      ${p}\n`);
	}
};

export const hookRun = async (agent: AgentName, flags?: { stop?: boolean }): Promise<void> => {
	if (process.stdin.isTTY) {
		process.stderr.write(
			`aislop hook ${agent} is an internal callback the agent invokes automatically. It reads a payload on stdin and has nothing to do interactively.\n\nYou probably want:\n  aislop hook install --${agent}     (install the hook for ${agent})\n  aislop hook status                   (see what's installed)\n  aislop hook uninstall --${agent}   (remove it)\n`,
		);
		process.exit(0);
	}
	let exitCode = 0;
	if (agent === "claude") {
		exitCode = flags?.stop ? await runClaudeStopHook() : await runClaudeHook();
	} else if (agent === "cursor") {
		exitCode = await runCursorHook();
	} else if (agent === "gemini") {
		exitCode = await runGeminiHook();
	} else {
		process.stderr.write(`hook: agent "${agent}" has no runtime adapter (rules-file-only)\n`);
		process.exit(0);
	}
	process.exit(exitCode);
};

export const hookBaseline = async (): Promise<void> => {
	const cwd = process.cwd();
	const result = await captureBaseline(cwd);
	process.stdout.write(`baseline captured: score=${result.score} files=${result.fileCount}\n`);
	process.stdout.write(`  -> ${result.path}\n`);
};

export const parseAgentFlag = (raw: string | undefined, fallback: AgentName[]): AgentName[] => {
	if (!raw) return fallback;
	const parts = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const unknown = parts.filter((p): p is AgentName => !ALL_AGENTS.includes(p as AgentName));
	if (unknown.length > 0) {
		throw new Error(`Unknown agent(s): ${unknown.join(", ")}. Valid: ${ALL_AGENTS.join(", ")}`);
	}
	return parts as AgentName[];
};

export const defaultInstallTargets = (): AgentName[] => {
	return AGENTS_SUPPORTING_BOTH_SCOPES;
};

export const resolveAgents = (
	perAgentFlags: Partial<Record<AgentName, boolean>>,
	positional: string[],
	agentFlag: string | undefined,
	fallback: AgentName[],
): AgentName[] => {
	const flagged = ALL_AGENTS.filter((a) => perAgentFlags[a] === true);
	if (flagged.length > 0) return flagged;
	if (positional.length > 0) {
		const unknown = positional.filter((p): p is AgentName => !ALL_AGENTS.includes(p as AgentName));
		if (unknown.length > 0) {
			throw new Error(`Unknown agent(s): ${unknown.join(", ")}. Valid: ${ALL_AGENTS.join(", ")}`);
		}
		return positional as AgentName[];
	}
	return parseAgentFlag(agentFlag, fallback);
};

export const hasExplicitAgentSelection = (
	perAgentFlags: Partial<Record<AgentName, boolean>>,
	positional: string[],
	agentFlag: string | undefined,
): boolean => {
	if (ALL_AGENTS.some((a) => perAgentFlags[a] === true)) return true;
	if (positional.length > 0) return true;
	if (typeof agentFlag === "string" && agentFlag.trim().length > 0) return true;
	return false;
};

export const promptAgentSelection = async (
	mode: "install" | "uninstall",
	deps: { installed?: AgentName[] } = {},
): Promise<AgentName[] | null> => {
	const installed = deps.installed ?? [];
	const pool = mode === "uninstall" ? installed : ALL_AGENTS;
	if (pool.length === 0) return [];
	const preChecked =
		mode === "uninstall" ? installed : (AGENTS_SUPPORTING_BOTH_SCOPES as AgentName[]);
	const choice = await multiselect<AgentName>({
		message:
			mode === "install"
				? "Which agents should get aislop hooks?"
				: "Which agent hooks should be removed?",
		options: pool.map((a) => ({
			value: a,
			label: AGENT_LABELS[a].label,
			hint: AGENT_LABELS[a].hint,
		})),
		initialValues: preChecked.filter((a) => pool.includes(a)),
		required: false,
	});
	if (isCancel(choice)) return null;
	return choice as AgentName[];
};
