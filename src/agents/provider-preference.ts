import fs from "node:fs";
import path from "node:path";
import { type AgentProviderId, type AgentProviderSelection, providerIds } from "./providers.js";

export type AgentProviderSelectionSource = "cli" | "preference" | "auto";

interface AgentProviderPreference {
	provider: AgentProviderId;
	updatedAt: string | null;
}

interface ResolvedAgentProviderSelection {
	selection: AgentProviderSelection;
	source: AgentProviderSelectionSource;
	preference: AgentProviderPreference | null;
}

export const agentProviderPreferencePath = (root: string): string =>
	path.join(root, ".aislop", "agent", "provider.json");

const isProviderId = (value: unknown): value is AgentProviderId =>
	typeof value === "string" && providerIds().includes(value as AgentProviderId);

export const readAgentProviderPreference = (root: string): AgentProviderPreference | null => {
	const file = agentProviderPreferencePath(root);
	if (!fs.existsSync(file)) return null;
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
		if (!isProviderId(parsed.provider)) return null;
		return {
			provider: parsed.provider,
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
		};
	} catch {
		return null;
	}
};

export const writeAgentProviderPreference = (
	root: string,
	provider: AgentProviderId,
	date = new Date(),
): AgentProviderPreference => {
	const preference: AgentProviderPreference = {
		provider,
		updatedAt: date.toISOString(),
	};
	const file = agentProviderPreferencePath(root);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(preference, null, 2)}\n`, "utf-8");
	return preference;
};

export const clearAgentProviderPreference = (root: string): boolean => {
	const file = agentProviderPreferencePath(root);
	if (!fs.existsSync(file)) return false;
	fs.unlinkSync(file);
	return true;
};

export const resolveAgentProviderSelection = (input: {
	root: string;
	requested: AgentProviderSelection;
	explicit: boolean;
}): ResolvedAgentProviderSelection => {
	const preference = readAgentProviderPreference(input.root);
	if (input.explicit) {
		return { selection: input.requested, source: "cli", preference };
	}
	if (preference) {
		return { selection: preference.provider, source: "preference", preference };
	}
	return { selection: input.requested, source: "auto", preference: null };
};
