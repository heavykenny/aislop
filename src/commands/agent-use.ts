import {
	agentProviderPreferencePath,
	clearAgentProviderPreference,
	readAgentProviderPreference,
	writeAgentProviderPreference,
} from "../agents/provider-preference.js";
import {
	type AgentProviderId,
	type AgentProviderSelection,
	getProviderStatuses,
	providerIds,
} from "../agents/providers.js";
import { prepareAgentLocalState } from "../agents/worktree.js";
import {
	renderDisplayCommandRows,
	renderDisplayRows,
	renderDisplaySection,
} from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { log } from "../ui/logger.js";
import { APP_VERSION } from "../version.js";

interface AgentUseOptions {
	root: string;
	dryRun: boolean;
}

const isAgentProviderSelection = (value: string): value is AgentProviderSelection =>
	value === "auto" || providerIds().includes(value as AgentProviderId);

const providerLabel = (provider: AgentProviderId): string => {
	const status = getProviderStatuses().find((item) => item.provider.id === provider);
	return status?.provider.label ?? provider;
};

const renderCurrentPreference = (root: string): string => {
	const preference = readAgentProviderPreference(root);
	if (!preference) {
		return [
			renderDisplaySection("Default"),
			...renderDisplayRows([{ label: "Provider", value: "auto" }]),
			"",
			renderDisplaySection("Next"),
			...renderDisplayCommandRows([
				{ label: "Set", command: "aislop agent use codex|claude|opencode" },
			]),
			"",
		].join("\n");
	}
	const rows = [
		{ label: "Provider", value: `${providerLabel(preference.provider)} (${preference.provider})` },
		{ label: "Preference", value: agentProviderPreferencePath(root) },
		...(preference.updatedAt ? [{ label: "Updated", value: preference.updatedAt }] : []),
	];
	return `${[renderDisplaySection("Default"), ...renderDisplayRows(rows), ""].join("\n")}`;
};

const warnIfProviderNeedsSetup = (provider: AgentProviderId): void => {
	const status = getProviderStatuses().find((item) => item.provider.id === provider);
	if (!status) return;
	if (!status.installed) {
		log.warn(`${status.provider.label} is not installed on PATH yet.`);
		log.muted(`Install ${status.provider.bin}, then run \`aislop agent connect ${provider}\`.`);
		return;
	}
	if (status.authenticated === false) {
		log.warn(`${status.provider.label} is installed but not authenticated.`);
		log.muted(status.provider.loginHint);
	}
};

export const agentUseCommand = async (
	provider: string | undefined,
	options: AgentUseOptions,
): Promise<void> => {
	try {
		const { root } = await prepareAgentLocalState(options.root);
		process.stdout.write(
			renderHeader({
				version: APP_VERSION,
				command: "Agent provider",
				context: [provider ?? "current"],
			}),
		);
		if (!provider) {
			process.stdout.write(renderCurrentPreference(root));
			return;
		}
		if (!isAgentProviderSelection(provider)) {
			log.error(`Unknown provider. Use one of: auto, ${providerIds().join(", ")}.`);
			process.exitCode = 1;
			return;
		}
		if (provider === "auto") {
			if (options.dryRun) {
				process.stdout.write(
					`${[
						renderDisplaySection("Dry run"),
						...renderDisplayRows([{ label: "Change", value: "clear saved provider preference" }]),
						"",
					].join("\n")}`,
				);
				return;
			}
			const cleared = clearAgentProviderPreference(root);
			log.success(
				cleared
					? "Default provider cleared. Agent runs will auto-detect a local provider."
					: "Default provider is already auto.",
			);
			return;
		}
		if (options.dryRun) {
			process.stdout.write(
				`${[
					renderDisplaySection("Dry run"),
					...renderDisplayRows([
						{ label: "Provider", value: `${providerLabel(provider)} (${provider})` },
						{ label: "Preference", value: agentProviderPreferencePath(root) },
					]),
					"",
				].join("\n")}`,
			);
			return;
		}
		const preference = writeAgentProviderPreference(root, provider);
		log.success(`Default provider set to ${providerLabel(provider)} (${provider}).`);
		process.stdout.write(
			`${renderDisplayRows([
				{ label: "Preference", value: agentProviderPreferencePath(root) },
				...(preference.updatedAt ? [{ label: "Updated", value: preference.updatedAt }] : []),
			]).join("\n")}\n`,
		);
		warnIfProviderNeedsSetup(provider);
		log.muted("Override once with `aislop agent --provider <provider>`.");
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
};
