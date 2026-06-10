import { spawnSync } from "node:child_process";
import {
	type AgentProviderSelection,
	getProviderStatuses,
	type ProviderStatus,
	providerIds,
	resolveProvider,
} from "../agents/providers.js";
import { renderDisplayRows, renderDisplaySection } from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { log } from "../ui/logger.js";
import { style, theme } from "../ui/theme.js";
import { APP_VERSION } from "../version.js";

interface AgentConnectOptions {
	dryRun: boolean;
}

const commandText = (status: ProviderStatus): string =>
	[status.provider.loginCommand.command, ...status.provider.loginCommand.args].join(" ");

const resolveConnectProvider = (
	selection: AgentProviderSelection,
	statuses = getProviderStatuses(),
): ProviderStatus | null => {
	if (selection === "auto") return resolveProvider(selection, statuses);
	return statuses.find((status) => status.provider.id === selection) ?? null;
};

const renderConnectPlan = (status: ProviderStatus): string => {
	const state = status.installed
		? status.authenticated === false
			? "installed, auth needed"
			: "installed"
		: "not installed";
	return [
		renderDisplaySection("Plan"),
		...renderDisplayRows(
			[
				{ label: "Provider", value: status.provider.label },
				{ label: "State", value: state },
				...(status.version ? [{ label: "Version", value: status.version }] : []),
				{ label: "Command", value: commandText(status) },
			],
			{ indent: 3, labelWidth: 8 },
		),
		"",
	].join("\n");
};

export const agentConnectCommand = async (
	provider: AgentProviderSelection,
	options: AgentConnectOptions,
): Promise<void> => {
	process.stdout.write(
		renderHeader({
			version: APP_VERSION,
			command: "Agent connect",
			context: [provider],
		}),
	);

	const selected = resolveConnectProvider(provider);
	if (!selected) {
		log.error(`Unknown provider. Use one of: auto, ${providerIds().join(", ")}.`);
		process.exitCode = 1;
		return;
	}

	if (options.dryRun) {
		process.stdout.write(renderConnectPlan(selected));
		return;
	}

	if (!selected.installed) {
		log.error(`${selected.provider.label} is not installed on PATH.`);
		log.muted(`Install ${selected.provider.bin}, then run \`${commandText(selected)}\`.`);
		process.exitCode = 1;
		return;
	}

	if (selected.authenticated === true) {
		log.success(`${selected.provider.label} is already connected.`);
		if (selected.version) log.muted(selected.version);
		return;
	}

	log.raw(`Running ${style(theme, "bold", commandText(selected))}`);
	const result = spawnSync(
		selected.provider.loginCommand.command,
		selected.provider.loginCommand.args,
		{
			stdio: "inherit",
			env: process.env,
		},
	);
	if (result.error || result.status !== 0) {
		log.error(
			result.error?.message ||
				`${selected.provider.label} connect command exited ${result.status ?? "unknown"}.`,
		);
		process.exitCode = result.status ?? 1;
		return;
	}

	const refreshed = resolveConnectProvider(selected.provider.id);
	if (refreshed?.authenticated === false) {
		log.warn(`${selected.provider.label} still reports auth as incomplete.`);
		log.muted(refreshed.provider.loginHint);
		return;
	}
	log.success(`${selected.provider.label} connect command finished.`);
	log.muted("Run `aislop agent providers` to inspect local provider status.");
	log.muted(`Set it as the repo default with \`aislop agent use ${selected.provider.id}\`.`);
};
