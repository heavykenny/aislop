import os from "node:os";
import type { Command } from "commander";
import {
	defaultInstallTargets,
	hasExplicitAgentSelection,
	hookBaseline,
	hookInstall,
	hookRun,
	hookStatus,
	hookUninstall,
	promptAgentSelection,
	resolveAgents,
} from "../commands/hook.js";
import { type AgentName, detectInstalledAgents } from "../hooks/install/registry.js";

type AgentFlagOpts = Partial<
	Record<
		| "claude"
		| "cursor"
		| "gemini"
		| "codex"
		| "windsurf"
		| "cline"
		| "kilocode"
		| "antigravity"
		| "copilot",
		boolean
	>
>;

const AGENT_NAMES = [
	"claude",
	"cursor",
	"gemini",
	"codex",
	"windsurf",
	"cline",
	"kilocode",
	"antigravity",
	"copilot",
] as const;

const resolveScope = (flags: { global?: boolean; project?: boolean }): "global" | "project" => {
	if (flags.project) return "project";
	if (flags.global) return "global";
	return "global";
};

const promptForUninstall = async (): Promise<AgentName[] | null> => {
	const installed = detectInstalledAgents({ home: os.homedir(), cwd: process.cwd() });
	if (installed.length === 0) {
		process.stdout.write("No aislop hooks installed. Nothing to uninstall.\n");
		return [];
	}
	const picked = await promptAgentSelection("uninstall", { installed });
	if (picked === null) {
		process.stdout.write("Cancelled.\n");
		return null;
	}
	if (picked.length === 0) {
		process.stdout.write("No agents selected. Nothing to uninstall.\n");
		return [];
	}
	return picked;
};

const promptForInstall = async (): Promise<AgentName[] | null> => {
	const picked = await promptAgentSelection("install");
	if (picked === null) {
		process.stdout.write("Cancelled.\n");
		return null;
	}
	if (picked.length === 0) {
		process.stdout.write("No agents selected. Nothing to install.\n");
		return [];
	}
	return picked;
};

const pickAgents = async (
	mode: "install" | "uninstall",
	opts: AgentFlagOpts & { agent?: string },
	positional: string[],
): Promise<AgentName[] | null> => {
	if (hasExplicitAgentSelection(opts, positional, opts.agent)) {
		return resolveAgents(opts, positional, opts.agent, defaultInstallTargets());
	}
	if (!process.stdin.isTTY) return defaultInstallTargets();
	return mode === "uninstall" ? promptForUninstall() : promptForInstall();
};

type InstallOpts = AgentFlagOpts & {
	agent?: string;
	global?: boolean;
	project?: boolean;
	dryRun?: boolean;
	yes?: boolean;
	qualityGate?: boolean;
};

type UninstallOpts = AgentFlagOpts & {
	agent?: string;
	global?: boolean;
	project?: boolean;
	dryRun?: boolean;
};

const registerInstall = (hook: Command): void => {
	const install = hook
		.command("install [agents...]")
		.description(
			"Install aislop hooks for one or more coding agents. Agents can be passed as positional args (aislop hook install claude cursor), per-agent flags (--claude), or via --agent. Default: every supported agent.",
		)
		.option(
			"--agent <names>",
			"comma-separated agent list (claude,cursor,gemini,codex,windsurf,cline,kilocode,antigravity,copilot)",
		)
		.option("-g, --global", "install to the user-scope config (default for agents that support it)")
		.option("--project", "install to the project-scope config")
		.option("--dry-run", "print the planned diff without writing")
		.option("--yes", "skip the confirmation prompt (reserved)")
		.option(
			"--quality-gate",
			"add a Stop hook that blocks when score regresses below baseline (Claude only)",
		);
	for (const a of AGENT_NAMES) install.option(`--${a}`, `shortcut for --agent ${a}`);
	install.action(async (positional: string[], opts: InstallOpts) => {
		const agents = await pickAgents("install", opts, positional);
		if (agents === null || agents.length === 0) return;
		await hookInstall({
			agents,
			scope: resolveScope(opts),
			dryRun: Boolean(opts.dryRun),
			yes: Boolean(opts.yes),
			qualityGate: Boolean(opts.qualityGate),
		});
	});
};

const registerUninstall = (hook: Command): void => {
	const uninstall = hook
		.command("uninstall [agents...]")
		.description(
			"Uninstall aislop hooks for one or more coding agents. Accepts positional args, per-agent flags (--claude), or --agent. Default: every supported agent.",
		)
		.option("--agent <names>", "comma-separated agent list")
		.option("-g, --global", "uninstall from user-scope config")
		.option("--project", "uninstall from project-scope config")
		.option("--dry-run", "print the planned removal without writing");
	for (const a of AGENT_NAMES) uninstall.option(`--${a}`, `shortcut for --agent ${a}`);
	uninstall.action(async (positional: string[], opts: UninstallOpts) => {
		const agents = await pickAgents("uninstall", opts, positional);
		if (agents === null || agents.length === 0) return;
		await hookUninstall({
			agents,
			scope: resolveScope(opts),
			dryRun: Boolean(opts.dryRun),
			yes: true,
			qualityGate: false,
		});
	});
};

const registerCallbacks = (hook: Command): void => {
	hook
		.command("status")
		.description("Show which agent hooks are installed")
		.action(async () => {
			await hookStatus();
		});
	hook
		.command("baseline")
		.description("Capture the current project score as the quality-gate baseline")
		.action(async () => {
			await hookBaseline();
		});
	hook
		.command("claude")
		.description("Internal: Claude Code PostToolUse / Stop callback (reads stdin)")
		.option("--stop", "run in Stop-hook mode for the quality gate")
		.action(async (opts: { stop?: boolean }) => {
			await hookRun("claude", { stop: Boolean(opts.stop) });
		});
	hook
		.command("cursor")
		.description("Internal: Cursor afterFileEdit callback (reads stdin)")
		.action(async () => {
			await hookRun("cursor");
		});
	hook
		.command("gemini")
		.description("Internal: Gemini CLI AfterTool callback (reads stdin)")
		.action(async () => {
			await hookRun("gemini");
		});
};

export const registerHookCommand = (program: Command): void => {
	const hook = program.command("hook").description("Install or invoke AI-agent integration hooks");
	registerInstall(hook);
	registerUninstall(hook);
	registerCallbacks(hook);
};
