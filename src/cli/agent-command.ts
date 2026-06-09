import type { Command } from "commander";
import { agentCommand } from "../commands/agent.js";
import { agentConnectCommand } from "../commands/agent-connect.js";
import { agentPlanCommand } from "../commands/agent-plan.js";
import { agentProvidersCommand } from "../commands/agent-providers.js";
import { agentUseCommand } from "../commands/agent-use.js";
import {
	addAgentOptions,
	agentOptionsFromFlags,
	agentTelemetryProperties,
	type AgentConnectFlags,
	type AgentFlags,
	type AgentUseFlags,
	telemetryProvider,
	withAgentLifecycle,
} from "./agent-command-options.js";
import { registerAgentMonitorSubcommands } from "./agent-monitor-command.js";
import { registerAgentSessionSubcommands } from "./agent-session-command.js";

const registerProviderSubcommands = (agent: Command): void => {
	agent
		.command("connect [provider]")
		.description("Connect to a local coding-agent provider using its own CLI auth")
		.option("--dry-run", "print the provider login command without running it")
		.action(async (provider, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentConnectFlags;
			const selection = (provider ?? "auto") as "auto" | "codex" | "claude" | "opencode";
			await withAgentLifecycle(
				"agent_connect",
				".",
				{
					provider: telemetryProvider(selection),
					provider_supplied: provider !== undefined,
					dry_run: Boolean(flags.dryRun),
				},
				async () => {
					await agentConnectCommand(selection, {
						dryRun: Boolean(flags.dryRun),
					});
				},
			);
		});

	agent
		.command("providers")
		.description("Show local coding-agent providers and setup hints")
		.action(async () => {
			await withAgentLifecycle("agent_providers", ".", {}, async () => {
				await agentProvidersCommand();
			});
		});

	agent
		.command("use [provider]")
		.alias("switch")
		.description("Set or show the default local agent provider for this repo")
		.option("--root <directory>", "git repository to store the local provider preference", ".")
		.option("--dry-run", "print the provider preference change without writing")
		.action(async (provider, _flags, command) => {
			const flags = command.optsWithGlobals() as AgentUseFlags;
			const root = flags.root ?? ".";
			await withAgentLifecycle(
				"agent_use",
				root,
				{
					provider: telemetryProvider(provider),
					provider_supplied: provider !== undefined,
					custom_root: root !== ".",
					dry_run: Boolean(flags.dryRun),
				},
				async () => {
					await agentUseCommand(provider, {
						root,
						dryRun: Boolean(flags.dryRun),
					});
				},
			);
		});
};

const registerPlanSubcommand = (agent: Command): void => {
	const plan = agent
		.command("plan [directory]")
		.description("Preview provider, worktree, findings, and publish actions without editing");

	addAgentOptions(plan);

	plan.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as AgentFlags;
		const options = agentOptionsFromFlags(flags, command);
		await withAgentLifecycle(
			"agent_plan",
			directory,
			agentTelemetryProperties(options),
			async () => {
				await agentPlanCommand(directory, options);
			},
		);
	});
};

export const registerAgentCommand = (program: Command): void => {
	const agent = program
		.command("agent [directory]")
		.description("Run a local AI slop repair session with Codex, Claude Code, or OpenCode");

	addAgentOptions(agent);

	agent.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as AgentFlags;
		const options = agentOptionsFromFlags(flags, command);
		await withAgentLifecycle("agent", directory, agentTelemetryProperties(options), async () => {
			return await agentCommand(directory, options);
		});
	});

	registerProviderSubcommands(agent);
	registerPlanSubcommand(agent);
	registerAgentMonitorSubcommands(agent);
	registerAgentSessionSubcommands(agent);
};
