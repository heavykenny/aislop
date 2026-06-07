import type { Command } from "commander";
import { agentCommand } from "../commands/agent.js";
import { agentApplyCommand } from "../commands/agent-apply.js";
import { agentConnectCommand } from "../commands/agent-connect.js";
import {
	agentMonitorListCommand,
	agentMonitorShowCommand,
	agentMonitorStopCommand,
} from "../commands/agent-monitor-lifecycle.js";
import { agentMonitorCommand } from "../commands/agent-monitor.js";
import { agentPlanCommand } from "../commands/agent-plan.js";
import { agentProvidersCommand } from "../commands/agent-providers.js";
import { agentSessionsCommand, agentShowCommand } from "../commands/agent-sessions.js";
import { agentStopCommand } from "../commands/agent-stop.js";
import { agentUseCommand } from "../commands/agent-use.js";
import { agentWatchCommand } from "../commands/agent-watch.js";

const parseInteger = (value: string): number => Number.parseInt(value, 10);

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

interface AgentFlags {
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

interface AgentConnectFlags {
	dryRun?: boolean;
}

interface AgentUseFlags {
	root?: string;
	dryRun?: boolean;
}

interface AgentSessionsFlags {
	limit?: number;
}

interface AgentShowFlags {
	root?: string;
}

interface AgentApplyFlags {
	root?: string;
	dryRun?: boolean;
	yes?: boolean;
}

interface AgentWatchFlags {
	root?: string;
	interval?: number;
	once?: boolean;
}

interface AgentStopFlags {
	root?: string;
	force?: boolean;
}

interface AgentMonitorFlags extends AgentFlags {
	interval?: number;
	debounce?: number;
	once?: boolean;
	repair?: boolean;
}

const addAgentOptions = (command: Command): void => {
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

const addMonitorOptions = (command: Command): void => {
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

const agentOptionsFromFlags = (flags: AgentFlags, command: Command) => ({
	provider: (flags.provider ?? "auto") as "auto" | "codex" | "claude" | "opencode",
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

const registerProviderSubcommands = (agent: Command): void => {
	agent
		.command("connect [provider]")
		.description("Connect to a local coding-agent provider using its own CLI auth")
		.option("--dry-run", "print the provider login command without running it")
		.action(async (provider = "auto", _flags, command) => {
			const flags = command.optsWithGlobals() as AgentConnectFlags;
			await agentConnectCommand(provider as "auto" | "codex" | "claude" | "opencode", {
				dryRun: Boolean(flags.dryRun),
			});
		});

	agent
		.command("providers")
		.description("Show local coding-agent providers and setup hints")
		.action(async () => {
			await agentProvidersCommand();
		});

	agent
		.command("use [provider]")
		.alias("switch")
		.description("Set or show the default local agent provider for this repo")
		.option("--root <directory>", "git repository to store the local provider preference", ".")
		.option("--dry-run", "print the provider preference change without writing")
		.action(async (provider, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentUseFlags;
			await agentUseCommand(provider, {
				root: flags.root ?? ".",
				dryRun: Boolean(flags.dryRun),
			});
		});
};

const registerPlanSubcommand = (agent: Command): void => {
	const plan = agent
		.command("plan [directory]")
		.description("Preview provider, worktree, findings, and publish actions without editing");

	addAgentOptions(plan);

	plan.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as AgentFlags;
		await agentPlanCommand(directory, agentOptionsFromFlags(flags, command));
	});
};

const registerMonitorSubcommand = (agent: Command): void => {
	const monitor = agent
		.command("monitor [directory]")
		.description("Watch local git changes and stream scan or repair cycles");

	addMonitorOptions(monitor);

	monitor.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as AgentMonitorFlags;
		await agentMonitorCommand(directory, {
			...agentOptionsFromFlags(flags, command),
			interval: flags.interval ?? 5000,
			debounce: flags.debounce ?? 1500,
			once: Boolean(flags.once),
			repair: Boolean(flags.repair),
		});
	});

	monitor
		.command("list [directory]")
		.description("List local background agent monitors")
		.option("--limit <n>", "maximum monitors to show", parseInteger, 10)
		.action(async (directory = ".", _flags, command) => {
			const flags = command.optsWithGlobals() as AgentSessionsFlags;
			await agentMonitorListCommand(directory, { limit: flags.limit ?? 10 });
		});

	monitor
		.command("show [monitor]")
		.description("Show a background agent monitor record")
		.option("--root <directory>", "git repository to read monitors from", ".")
		.action(async (monitorId, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentShowFlags;
			await agentMonitorShowCommand(monitorId, { root: flags.root ?? "." });
		});

	monitor
		.command("stop [monitor]")
		.description("Stop a running background agent monitor")
		.option("--root <directory>", "git repository to read monitors from", ".")
		.option("--force", "send SIGKILL instead of SIGTERM")
		.action(async (monitorId, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentStopFlags;
			await agentMonitorStopCommand(monitorId, {
				root: flags.root ?? ".",
				force: Boolean(flags.force),
			});
		});
};

const registerSessionSubcommands = (agent: Command): void => {
	agent
		.command("sessions [directory]")
		.description("List recent local agent sessions")
		.option("--limit <n>", "maximum sessions to show", parseInteger, 10)
		.action(async (directory = ".", _flags, command) => {
			const flags = command.optsWithGlobals() as AgentSessionsFlags;
			await agentSessionsCommand(directory, { limit: flags.limit ?? 10 });
		});

	agent
		.command("show [session]")
		.description("Show a local agent session summary and timeline")
		.option("--root <directory>", "git repository to read sessions from", ".")
		.action(async (session, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentShowFlags;
			await agentShowCommand(session, { root: flags.root ?? "." });
		});

	agent
		.command("apply [session]")
		.description("Apply a reviewed isolated worktree session back to the repo")
		.option("--root <directory>", "git repository to read sessions from", ".")
		.option("--dry-run", "preview the session diff without applying it")
		.option("-y, --yes", "skip confirmation prompts")
		.action(async (session, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentApplyFlags;
			await agentApplyCommand(session, {
				root: flags.root ?? ".",
				dryRun: Boolean(flags.dryRun),
				yes: Boolean(flags.yes),
			});
		});

	agent
		.command("watch [session]")
		.description("Watch a local agent session as it streams")
		.option("--root <directory>", "git repository to read sessions from", ".")
		.option("--interval <ms>", "poll interval while following", parseInteger, 1000)
		.option("--once", "print the current session events and exit")
		.action(async (session, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentWatchFlags;
			await agentWatchCommand(session, {
				root: flags.root ?? ".",
				interval: flags.interval ?? 1000,
				once: Boolean(flags.once),
			});
		});

	agent
		.command("stop [session]")
		.description("Stop a running background agent session")
		.option("--root <directory>", "git repository to read sessions from", ".")
		.option("--force", "send SIGKILL instead of SIGTERM")
		.action(async (session, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentStopFlags;
			await agentStopCommand(session, {
				root: flags.root ?? ".",
				force: Boolean(flags.force),
			});
		});
};

export const registerAgentCommand = (program: Command): void => {
	const agent = program
		.command("agent [directory]")
		.description("Run a local AI slop repair session with Codex, Claude Code, or OpenCode");

	addAgentOptions(agent);

	agent.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as AgentFlags;
		await agentCommand(directory, agentOptionsFromFlags(flags, command));
	});

	registerProviderSubcommands(agent);
	registerPlanSubcommand(agent);
	registerMonitorSubcommand(agent);
	registerSessionSubcommands(agent);
};
