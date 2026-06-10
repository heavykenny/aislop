import type { Command } from "commander";
import {
	agentMonitorListCommand,
	agentMonitorShowCommand,
	agentMonitorStopCommand,
} from "../commands/agent-monitor-lifecycle.js";
import { agentMonitorCommand } from "../commands/agent-monitor.js";
import {
	addMonitorOptions,
	agentOptionsFromFlags,
	type AgentMonitorFlags,
	type AgentSessionsFlags,
	type AgentShowFlags,
	type AgentStopFlags,
	monitorTelemetryProperties,
	parseInteger,
	withAgentLifecycle,
} from "./agent-command-options.js";

const registerMonitorRunCommand = (monitor: Command): void => {
	monitor.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as AgentMonitorFlags;
		const options = {
			...agentOptionsFromFlags(flags, command),
			interval: flags.interval ?? 5000,
			debounce: flags.debounce ?? 1500,
			once: Boolean(flags.once),
			repair: Boolean(flags.repair),
		};
		await withAgentLifecycle(
			"agent_monitor",
			directory,
			monitorTelemetryProperties(options),
			async () => {
				await agentMonitorCommand(directory, options);
			},
		);
	});
};

const registerMonitorListCommand = (monitor: Command): void => {
	monitor
		.command("list [directory]")
		.description("List local background agent monitors")
		.option("--limit <n>", "maximum monitors to show", parseInteger, 10)
		.action(async (directory = ".", _flags, command) => {
			const flags = command.optsWithGlobals() as AgentSessionsFlags;
			await withAgentLifecycle(
				"agent_monitor_list",
				directory,
				{ result_limit: flags.limit ?? 10 },
				async () => {
					await agentMonitorListCommand(directory, { limit: flags.limit ?? 10 });
				},
			);
		});
};

const registerMonitorShowCommand = (monitor: Command): void => {
	monitor
		.command("show [monitor]")
		.description("Show a background agent monitor record")
		.option("--root <directory>", "git repository to read monitors from", ".")
		.action(async (monitorId, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentShowFlags;
			const root = flags.root ?? ".";
			await withAgentLifecycle(
				"agent_monitor_show",
				root,
				{
					monitor_supplied: monitorId !== undefined,
					custom_root: root !== ".",
				},
				async () => {
					await agentMonitorShowCommand(monitorId, { root });
				},
			);
		});
};

const registerMonitorStopCommand = (monitor: Command): void => {
	monitor
		.command("stop [monitor]")
		.description("Stop a running background agent monitor")
		.option("--root <directory>", "git repository to read monitors from", ".")
		.option("--force", "send SIGKILL instead of SIGTERM")
		.action(async (monitorId, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentStopFlags;
			const root = flags.root ?? ".";
			await withAgentLifecycle(
				"agent_monitor_stop",
				root,
				{
					monitor_supplied: monitorId !== undefined,
					custom_root: root !== ".",
					force: Boolean(flags.force),
				},
				async () => {
					await agentMonitorStopCommand(monitorId, {
						root,
						force: Boolean(flags.force),
					});
				},
			);
		});
};

export const registerAgentMonitorSubcommands = (agent: Command): void => {
	const monitor = agent
		.command("monitor [directory]")
		.description("Watch local git changes and stream scan or repair cycles");

	addMonitorOptions(monitor);
	registerMonitorRunCommand(monitor);
	registerMonitorListCommand(monitor);
	registerMonitorShowCommand(monitor);
	registerMonitorStopCommand(monitor);
};
