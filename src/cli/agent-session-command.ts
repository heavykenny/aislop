import type { Command } from "commander";
import { agentApplyCommand } from "../commands/agent-apply.js";
import { agentSessionsCommand, agentShowCommand } from "../commands/agent-sessions.js";
import { agentStopCommand } from "../commands/agent-stop.js";
import { agentWatchCommand } from "../commands/agent-watch.js";
import {
	type AgentApplyFlags,
	type AgentSessionsFlags,
	type AgentShowFlags,
	type AgentStopFlags,
	type AgentWatchFlags,
	parseInteger,
	withAgentLifecycle,
} from "./agent-command-options.js";

const registerSessionsListCommand = (agent: Command): void => {
	agent
		.command("sessions [directory]")
		.description("List recent local agent sessions")
		.option("--limit <n>", "maximum sessions to show", parseInteger, 10)
		.action(async (directory = ".", _flags, command) => {
			const flags = command.optsWithGlobals() as AgentSessionsFlags;
			await withAgentLifecycle(
				"agent_sessions",
				directory,
				{ result_limit: flags.limit ?? 10 },
				async () => {
					await agentSessionsCommand(directory, { limit: flags.limit ?? 10 });
				},
			);
		});
};

const registerSessionShowCommand = (agent: Command): void => {
	agent
		.command("show [session]")
		.description("Show a local agent session summary and timeline")
		.option("--root <directory>", "git repository to read sessions from", ".")
		.action(async (session, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentShowFlags;
			const root = flags.root ?? ".";
			await withAgentLifecycle(
				"agent_show",
				root,
				{
					session_supplied: session !== undefined,
					custom_root: root !== ".",
				},
				async () => {
					await agentShowCommand(session, { root });
				},
			);
		});
};

const registerSessionApplyCommand = (agent: Command): void => {
	agent
		.command("apply [session]")
		.description("Apply a reviewed isolated worktree session back to the repo")
		.option("--root <directory>", "git repository to read sessions from", ".")
		.option("--dry-run", "preview the session diff without applying it")
		.option("-y, --yes", "skip confirmation prompts")
		.action(async (session, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentApplyFlags;
			const root = flags.root ?? ".";
			await withAgentLifecycle(
				"agent_apply",
				root,
				{
					session_supplied: session !== undefined,
					custom_root: root !== ".",
					dry_run: Boolean(flags.dryRun),
					confirmed_noninteractive: Boolean(flags.yes),
				},
				async () => {
					await agentApplyCommand(session, {
						root,
						dryRun: Boolean(flags.dryRun),
						yes: Boolean(flags.yes),
					});
				},
			);
		});
};

const registerSessionWatchCommand = (agent: Command): void => {
	agent
		.command("watch [session]")
		.description("Watch a local agent session as it streams")
		.option("--root <directory>", "git repository to read sessions from", ".")
		.option("--interval <ms>", "poll interval while following", parseInteger, 1000)
		.option("--once", "print the current session events and exit")
		.action(async (session, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentWatchFlags;
			const root = flags.root ?? ".";
			await withAgentLifecycle(
				"agent_watch",
				root,
				{
					session_supplied: session !== undefined,
					custom_root: root !== ".",
					interval_ms: flags.interval ?? 1000,
					once: Boolean(flags.once),
				},
				async () => {
					await agentWatchCommand(session, {
						root,
						interval: flags.interval ?? 1000,
						once: Boolean(flags.once),
					});
				},
			);
		});
};

const registerSessionStopCommand = (agent: Command): void => {
	agent
		.command("stop [session]")
		.description("Stop a running background agent session")
		.option("--root <directory>", "git repository to read sessions from", ".")
		.option("--force", "send SIGKILL instead of SIGTERM")
		.action(async (session, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentStopFlags;
			const root = flags.root ?? ".";
			await withAgentLifecycle(
				"agent_stop",
				root,
				{
					session_supplied: session !== undefined,
					custom_root: root !== ".",
					force: Boolean(flags.force),
				},
				async () => {
					await agentStopCommand(session, {
						root,
						force: Boolean(flags.force),
					});
				},
			);
		});
};

export const registerAgentSessionSubcommands = (agent: Command): void => {
	registerSessionsListCommand(agent);
	registerSessionShowCommand(agent);
	registerSessionApplyCommand(agent);
	registerSessionWatchCommand(agent);
	registerSessionStopCommand(agent);
};
