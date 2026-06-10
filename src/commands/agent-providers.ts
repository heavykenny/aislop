import { readAgentProviderPreference } from "../agents/provider-preference.js";
import { getProviderStatuses, type ProviderStatus, providerIds } from "../agents/providers.js";
import { prepareAgentLocalState } from "../agents/worktree.js";
import {
	type DisplayRow,
	type DisplayStatusItem,
	renderDisplayCommandRows,
	renderDisplayRows,
	renderDisplaySection,
	renderDisplayStatusItems,
} from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { style, theme } from "../ui/theme.js";
import { APP_VERSION } from "../version.js";

const providerState = (status: ProviderStatus): string => {
	if (!status.installed) return "not installed";
	if (status.authenticated === false) return "installed, auth needed";
	return "ready";
};

const providerStatusItem = (status: ProviderStatus): DisplayStatusItem => {
	const marker = status.installed
		? status.authenticated === false
			? style(theme, "warn", "!")
			: style(theme, "success", "✓")
		: style(theme, "muted", "·");
	const rows: DisplayRow[] = [{ label: "Status", value: providerState(status) }];
	if (status.version) rows.push({ label: "Version", value: status.version });
	if (status.authHint) rows.push({ label: "Auth", value: status.authHint });
	rows.push({ label: "Connect", value: `aislop agent connect ${status.provider.id}` });
	return { marker, label: status.provider.label, rows };
};

export const renderAgentProviders = (
	input: { preference?: string | null; statuses?: ProviderStatus[] } = {},
): string => {
	const statuses = input.statuses ?? getProviderStatuses();
	const defaultProvider = input.preference
		? `${statuses.find((status) => status.provider.id === input.preference)?.provider.label ?? input.preference} (${input.preference})`
		: "auto";
	const lines = [
		renderHeader({
			version: APP_VERSION,
			command: "Agent providers",
			context: ["local"],
		}).trimEnd(),
		"",
		renderDisplaySection("Default"),
		...renderDisplayRows([{ label: "Provider", value: defaultProvider }]),
		"",
		renderDisplaySection("Providers"),
		...renderDisplayStatusItems(statuses.map(providerStatusItem), { labelWidth: 7 }),
	];
	lines.push(
		"",
		renderDisplaySection("Actions"),
		...renderDisplayCommandRows(
			[
				{ label: "Switch", command: `aislop agent --provider <${providerIds().join("|")}|auto>` },
				{ label: "Save", command: "aislop agent use <provider|auto>" },
			],
			{ indent: 3 },
		),
	);
	return `${lines.join("\n")}\n`;
};

export const agentProvidersCommand = async (): Promise<void> => {
	let preference: string | null = null;
	try {
		const { root } = await prepareAgentLocalState(process.cwd());
		preference = readAgentProviderPreference(root)?.provider ?? null;
	} catch {
		preference = null;
	}
	process.stdout.write(renderAgentProviders({ preference }));
};
