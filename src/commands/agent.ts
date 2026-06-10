import path from "node:path";
import { performance } from "node:perf_hooks";
import { resolveAgentProviderSelection } from "../agents/provider-preference.js";
import { getProviderStatuses, type ProviderStatus, resolveProvider } from "../agents/providers.js";
import { readAgentRoot } from "../agents/worktree.js";
import { renderDisplayRows, renderDisplaySection } from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { log } from "../ui/logger.js";
import { agentConnectCommand } from "./agent-connect.js";
import { APP_VERSION } from "../version.js";
import { launchAgentInBackground, renderBackgroundLaunch } from "./agent-background.js";
import { runAgentSession, type AgentSessionRunTelemetry } from "./agent-session.js";
import type { AgentOptions } from "./agent-types.js";

const providerSourceText = (options: AgentOptions): string => {
	if (options.providerSource === "cli") return "--provider flag";
	if (options.providerSource === "preference") {
		return `saved local default (${options.providerPreference ?? options.provider})`;
	}
	return "auto-detect installed provider";
};

const loginCommandText = (status: ProviderStatus): string =>
	[status.provider.loginCommand.command, ...status.provider.loginCommand.args].join(" ");

const guideNoProvider = (statuses: ProviderStatus[]): void => {
	const anyInstalled = statuses.some((status) => status.installed);
	log.error(
		anyInstalled
			? "No coding agent is ready to run."
			: "No coding agent is installed. `aislop agent` drives Codex, Claude Code, or OpenCode.",
	);
	for (const status of statuses) {
		const state = !status.installed
			? "not installed"
			: status.authenticated === false
				? `installed · sign in with \`${loginCommandText(status)}\``
				: "ready";
		log.muted(`  ${status.provider.label.padEnd(12)} ${state}`);
	}
	log.muted("Set one up, then re-run. `aislop agent connect` walks through it too.");
};

// Resolve a provider that is installed and signed in. When the chosen provider is
// installed but not signed in, offer to run its login here (TTY only) and re-check.
const resolveReadyProvider = async (
	provider: AgentOptions["provider"],
): Promise<ProviderStatus | null> => {
	let selected = resolveProvider(provider);
	if (!selected || !selected.installed) {
		guideNoProvider(getProviderStatuses());
		process.exitCode = 1;
		return null;
	}
	if (selected.authenticated === false) {
		if (!process.stdin.isTTY) {
			log.error(`${selected.provider.label} is installed but not signed in.`);
			log.muted(selected.provider.loginHint);
			process.exitCode = 1;
			return null;
		}
		// Run the connect flow inline (it runs the provider's interactive login), then re-check.
		log.muted(`${selected.provider.label} is not signed in — connecting…`);
		await agentConnectCommand(selected.provider.id, { dryRun: false });
		selected = resolveProvider(selected.provider.id);
		if (!selected || selected.authenticated === false) {
			process.exitCode = 1;
			return null;
		}
	}
	return selected;
};

const renderDryRun = (
	selected: ProviderStatus,
	resolvedDir: string,
	options: AgentOptions,
): void => {
	process.stdout.write(
		`${[
			renderDisplaySection("Dry run"),
			...renderDisplayRows(
				[
					{ label: "Provider", value: selected.provider.label },
					{ label: "Source", value: providerSourceText(options) },
					{ label: "Directory", value: resolvedDir },
					{ label: "Mode", value: options.inPlace ? "current worktree" : "isolated git worktree" },
					...(options.background ? [{ label: "Run", value: "background session" }] : []),
					{ label: "Target", value: `${options.targetScore}/100` },
					...(options.commit || options.pr
						? [
								{ label: "Publish", value: options.pr ? "commit + draft PR" : "commit only" },
								{ label: "Commit", value: options.commitMessage },
							]
						: []),
				],
				{ indent: 3, labelWidth: 9 },
			),
			"",
		].join("\n")}`,
	);
};

const providerTelemetry = (
	selected: ProviderStatus,
	options: AgentOptions,
): Record<string, unknown> => ({
	provider: selected.provider.id,
	provider_source: options.providerSource,
});

export const agentCommand = async (
	directory: string,
	options: AgentOptions,
): Promise<AgentSessionRunTelemetry | Record<string, unknown> | null> => {
	const started = performance.now();
	const resolvedDir = path.resolve(directory);
	let root: string;
	try {
		root = (await readAgentRoot(resolvedDir)).root;
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
		return { agent_result: "no_git_root" };
	}
	const providerChoice = resolveAgentProviderSelection({
		root,
		requested: options.provider,
		explicit: options.providerSource === "cli",
	});
	const resolvedOptions: AgentOptions = {
		...options,
		provider: providerChoice.selection,
		providerSource: providerChoice.source,
		providerPreference: providerChoice.preference?.provider,
	};
	process.stdout.write(
		renderHeader({
			version: APP_VERSION,
			command: "Agent session",
			context: [
				providerChoice.source === "preference"
					? `${providerChoice.selection} default`
					: providerChoice.selection === "auto"
						? "auto provider"
						: providerChoice.selection,
			],
		}),
	);
	if (providerChoice.source === "preference") {
		log.muted(`Using saved provider preference: ${providerChoice.selection}.`);
	}
	const selected = await resolveReadyProvider(resolvedOptions.provider);
	if (!selected) return { agent_result: "provider_unavailable" };
	if (resolvedOptions.dryRun) {
		renderDryRun(selected, resolvedDir, resolvedOptions);
		return { agent_result: "dry_run", ...providerTelemetry(selected, resolvedOptions) };
	}
	if (resolvedOptions.background) {
		try {
			renderBackgroundLaunch(await launchAgentInBackground(resolvedDir, resolvedOptions));
			return {
				agent_result: "background_started",
				...providerTelemetry(selected, resolvedOptions),
			};
		} catch (error) {
			log.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
			return { agent_result: "failed", ...providerTelemetry(selected, resolvedOptions) };
		}
	}
	const result = await runAgentSession(selected, resolvedDir, resolvedOptions, started);
	return result ? { ...result, ...providerTelemetry(selected, resolvedOptions) } : null;
};
