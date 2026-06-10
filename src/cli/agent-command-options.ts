import type { Command } from "commander";
import type { AgentProviderSelection } from "../agents/providers.js";
import { loadConfig } from "../config/index.js";
import type { AgentMonitorOptions } from "../commands/agent-monitor-types.js";
import type { AgentOptions } from "../commands/agent-types.js";
import { type CommandName, withCommandLifecycle } from "../telemetry/index.js";

export const parseInteger = (value: string): number => Number.parseInt(value, 10);

type AgentOption = {
	flag: string;
	description: string;
} & (
	| { parser: (value: string) => number; defaultValue: number }
	| { parser?: undefined; defaultValue?: string }
);

const AGENT_OPTIONS: AgentOption[] = [
	{
		flag: "--provider <provider>",
		description: "provider to use: auto, codex, claude, opencode",
		defaultValue: "auto",
	},
	{
		flag: "--target-score <score>",
		description: "score to converge toward",
		parser: parseInteger,
		defaultValue: 90,
	},
	{
		flag: "--max-turns <n>",
		description: "maximum provider turns for one repair attempt",
		parser: parseInteger,
		defaultValue: 4,
	},
	{
		flag: "--limit <n>",
		description: "maximum findings to hand to the provider",
		parser: parseInteger,
		defaultValue: 8,
	},
	{
		flag: "--in-place",
		description: "edit the current worktree instead of creating an isolated git worktree",
	},
	{ flag: "--apply", description: "apply the accepted diff back to the original worktree" },
	{ flag: "-y, --yes", description: "skip confirmation prompts for --apply" },
	{ flag: "--dry-run", description: "print the selected provider and plan without running it" },
	{ flag: "--background", description: "start the agent in the background and return immediately" },
	{ flag: "--no-fix", description: "skip deterministic safe fixes before provider handoff" },
	{ flag: "--commit", description: "commit the verified diff on an agent branch" },
	{ flag: "--pr", description: "push the agent branch and open a draft pull request" },
	{ flag: "--branch <name>", description: "branch name for --commit or --pr" },
	{ flag: "--base <branch>", description: "base branch for --pr" },
	{
		flag: "--commit-message <message>",
		description: "commit message for --commit or --pr",
		defaultValue: "chore(aislop): repair AI slop findings",
	},
	{ flag: "--title <title>", description: "pull request title for --pr" },
	{ flag: "--ready", description: "open a ready-for-review PR instead of a draft" },
	{
		flag: "--no-keep-worktree",
		description: "remove the generated worktree when it is safe to do so",
	},
	{ flag: "--cleanup", description: "remove the generated worktree even when a diff remains" },
];

export interface AgentFlags {
	provider?: string;
	targetScore?: number;
	maxTurns?: number;
	limit?: number;
	inPlace?: boolean;
	apply?: boolean;
	yes?: boolean;
	dryRun?: boolean;
	background?: boolean;
	fix?: boolean;
	commit?: boolean;
	pr?: boolean;
	branch?: string;
	base?: string;
	commitMessage?: string;
	title?: string;
	ready?: boolean;
	keepWorktree?: boolean;
	cleanup?: boolean;
}

export interface AgentConnectFlags {
	dryRun?: boolean;
}

export interface AgentUseFlags {
	root?: string;
	dryRun?: boolean;
}

export interface AgentSessionsFlags {
	limit?: number;
}

export interface AgentShowFlags {
	root?: string;
}

export interface AgentApplyFlags {
	root?: string;
	dryRun?: boolean;
	yes?: boolean;
}

export interface AgentWatchFlags {
	root?: string;
	interval?: number;
	once?: boolean;
}

export interface AgentStopFlags {
	root?: string;
	force?: boolean;
}

export interface AgentMonitorFlags extends AgentFlags {
	interval?: number;
	debounce?: number;
	once?: boolean;
	repair?: boolean;
}

export const addAgentOptions = (command: Command): void => {
	for (const option of AGENT_OPTIONS) {
		if (option.parser) {
			command.option(option.flag, option.description, option.parser, option.defaultValue);
		} else if (option.defaultValue !== undefined) {
			command.option(option.flag, option.description, option.defaultValue);
		} else {
			command.option(option.flag, option.description);
		}
	}
};

const MONITOR_AGENT_OPTIONS = [
	"--provider <provider>",
	"--target-score <score>",
	"--max-turns <n>",
	"--limit <n>",
	"--in-place",
	"--dry-run",
	"--no-fix",
] as const;

export const addMonitorOptions = (command: Command): void => {
	for (const option of AGENT_OPTIONS) {
		if (!MONITOR_AGENT_OPTIONS.includes(option.flag as (typeof MONITOR_AGENT_OPTIONS)[number])) {
			continue;
		}
		if (option.parser) {
			command.option(option.flag, option.description, option.parser, option.defaultValue);
		} else if (option.defaultValue !== undefined) {
			command.option(option.flag, option.description, option.defaultValue);
		} else {
			command.option(option.flag, option.description);
		}
	}
	command.option("--repair", "run bounded local repair sessions when scans miss the target");
	command.option("--background", "start the monitor in the background and return immediately");
	command.option("--interval <ms>", "poll interval for git changes", parseInteger, 5000);
	command.option("--debounce <ms>", "quiet period before reacting to a change", parseInteger, 1500);
	command.option("--once", "run one monitor cycle and exit");
};

const providerSourceFrom = (command: Command): "cli" | "auto" =>
	command.getOptionValueSourceWithGlobals("provider") === "default" ? "auto" : "cli";

const TELEMETRY_PROVIDERS = new Set(["auto", "codex", "claude", "opencode"]);

export const telemetryProvider = (provider: string | undefined): string => {
	if (!provider) return "none";
	return TELEMETRY_PROVIDERS.has(provider) ? provider : "unknown";
};

const exitCodeFromProcess = (): number => {
	const code = process.exitCode;
	if (typeof code === "number") return code;
	if (typeof code === "string") {
		const parsed = Number.parseInt(code, 10);
		return Number.isFinite(parsed) ? parsed : 1;
	}
	return 0;
};

export const withAgentLifecycle = async (
	command: CommandName,
	configDirectory: string,
	properties: Record<string, unknown>,
	run: () => Promise<Record<string, unknown> | null | undefined | void>,
): Promise<void> => {
	await withCommandLifecycle(
		{
			command,
			config: loadConfig(configDirectory).telemetry,
			properties,
		},
		async () => {
			const completionProperties = await run();
			return {
				exitCode: exitCodeFromProcess(),
				properties: completionProperties ?? undefined,
			};
		},
	);
};

export const agentTelemetryProperties = (options: AgentOptions): Record<string, unknown> => ({
	provider: telemetryProvider(options.provider),
	provider_source: options.providerSource,
	target_score: options.targetScore,
	max_turns: options.maxTurns,
	finding_limit: options.limit,
	worktree_mode: options.inPlace ? "current" : "isolated",
	apply_requested: options.apply,
	dry_run: options.dryRun,
	background: options.background,
	no_fix: options.noFix,
	publish_mode: options.pr ? "pr" : options.commit ? "commit" : "none",
	ready_pr: options.ready,
	keep_worktree: options.keepWorktree,
	cleanup_requested: options.cleanup,
	confirmed_noninteractive: options.yes,
});

export const monitorTelemetryProperties = (
	options: AgentMonitorOptions,
): Record<string, unknown> => ({
	...agentTelemetryProperties(options),
	interval_ms: options.interval,
	debounce_ms: options.debounce,
	once: options.once,
	repair: options.repair,
});

export const agentOptionsFromFlags = (flags: AgentFlags, command: Command): AgentOptions => ({
	provider: (flags.provider ?? "auto") as AgentProviderSelection,
	providerSource: providerSourceFrom(command),
	targetScore: flags.targetScore ?? 90,
	maxTurns: flags.maxTurns ?? 4,
	limit: flags.limit ?? 8,
	inPlace: Boolean(flags.inPlace),
	apply: Boolean(flags.apply),
	yes: Boolean(flags.yes),
	dryRun: Boolean(flags.dryRun),
	background: Boolean(flags.background),
	noFix: flags.fix === false,
	commit: Boolean(flags.commit) || Boolean(flags.pr),
	pr: Boolean(flags.pr),
	branch: flags.branch,
	base: flags.base,
	commitMessage: flags.commitMessage ?? "chore(aislop): repair AI slop findings",
	prTitle: flags.title,
	ready: Boolean(flags.ready),
	keepWorktree: flags.keepWorktree !== false,
	cleanup: Boolean(flags.cleanup),
});
