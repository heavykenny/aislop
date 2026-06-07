import path from "node:path";
import { performance } from "node:perf_hooks";
import { resolveAgentProviderSelection } from "../agents/provider-preference.js";
import { getProviderStatuses, type ProviderStatus, resolveProvider } from "../agents/providers.js";
import { prepareAgentLocalState } from "../agents/worktree.js";
import { renderDisplayRows, renderDisplaySection } from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { log } from "../ui/logger.js";
import { APP_VERSION } from "../version.js";
import { launchAgentInBackground, renderBackgroundLaunch } from "./agent-background.js";
import { runAgentSession } from "./agent-session.js";
import type { AgentOptions } from "./agent-types.js";

const providerSourceText = (options: AgentOptions): string => {
	if (options.providerSource === "cli") return "--provider flag";
	if (options.providerSource === "preference") {
		return `saved local default (${options.providerPreference ?? options.provider})`;
	}
	return "auto-detect installed provider";
};

const resolveReadyProvider = (provider: AgentOptions["provider"]): ProviderStatus | null => {
	const statuses = getProviderStatuses();
	const selected = resolveProvider(provider, statuses);
	if (!selected || !selected.installed) {
		log.error(
			`No usable provider found. Installed providers: ${
				statuses
					.filter((status) => status.installed)
					.map((status) => status.provider.id)
					.join(", ") || "none"
			}.`,
		);
		log.muted("Run `aislop agent providers` to see setup hints.");
		process.exitCode = 1;
		return null;
	}
	if (selected.authenticated === false) {
		log.error(`${selected.provider.label} is installed but not authenticated.`);
		log.muted(selected.provider.loginHint);
		process.exitCode = 1;
		return null;
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

export const agentCommand = async (directory: string, options: AgentOptions): Promise<void> => {
	const started = performance.now();
	const resolvedDir = path.resolve(directory);
	let root: string;
	try {
		root = (await prepareAgentLocalState(resolvedDir)).root;
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
		return;
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
	const selected = resolveReadyProvider(resolvedOptions.provider);
	if (!selected) return;
	if (resolvedOptions.dryRun) return renderDryRun(selected, resolvedDir, resolvedOptions);
	if (resolvedOptions.background) {
		try {
			return renderBackgroundLaunch(await launchAgentInBackground(resolvedDir, resolvedOptions));
		} catch (error) {
			log.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
			return;
		}
	}
	await runAgentSession(selected, resolvedDir, resolvedOptions, started);
};
