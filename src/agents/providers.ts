import { spawnSync } from "node:child_process";

const PROVIDER_PROBE_TIMEOUT_MS = 1200;

export type AgentProviderId = "codex" | "claude" | "opencode";
export type AgentProviderSelection = AgentProviderId | "auto";

export interface AgentProvider {
	id: AgentProviderId;
	label: string;
	bin: string;
	authCheck?: { command: string; args: string[]; okExitCodes?: number[] };
	loginCommand: { command: string; args: string[] };
	loginHint: string;
	buildArgs: (prompt: string, opts: { maxTurns: number }) => string[];
}

export interface ProviderStatus {
	provider: AgentProvider;
	installed: boolean;
	authenticated: boolean | null;
	version: string | null;
	authHint: string | null;
}

export const PROVIDERS: AgentProvider[] = [
	{
		id: "codex",
		label: "Codex",
		bin: "codex",
		loginCommand: { command: "codex", args: ["login"] },
		loginHint: "Run `codex login` or configure Codex the way you normally use it.",
		buildArgs: (prompt) => ["exec", "--json", prompt],
	},
	{
		id: "claude",
		label: "Claude Code",
		bin: "claude",
		authCheck: { command: "claude", args: ["auth", "status"], okExitCodes: [0] },
		loginCommand: { command: "claude", args: ["auth", "login"] },
		loginHint: "Run `claude auth login`.",
		buildArgs: (prompt, opts) => [
			"-p",
			"--output-format",
			"stream-json",
			"--max-turns",
			String(opts.maxTurns),
			prompt,
		],
	},
	{
		id: "opencode",
		label: "OpenCode",
		bin: "opencode",
		loginCommand: { command: "opencode", args: ["auth", "login"] },
		loginHint: "Run `opencode auth login`.",
		buildArgs: (prompt) => ["run", prompt],
	},
];

export const providerIds = (): AgentProviderId[] => PROVIDERS.map((provider) => provider.id);

const commandExists = (bin: string): boolean => {
	const command = process.platform === "win32" ? "where" : "which";
	const result = spawnSync(command, [bin], {
		encoding: "utf-8",
		timeout: PROVIDER_PROBE_TIMEOUT_MS,
	});
	return !result.error && result.status === 0;
};

const readVersion = (bin: string): string | null => {
	const result = spawnSync(bin, ["--version"], {
		encoding: "utf-8",
		timeout: PROVIDER_PROBE_TIMEOUT_MS,
	});
	if (result.error || result.status !== 0) return null;
	return (result.stdout || result.stderr).trim().split("\n")[0]?.trim() || null;
};

const checkAuth = (provider: AgentProvider): boolean | null => {
	if (!provider.authCheck) return null;
	const result = spawnSync(provider.authCheck.command, provider.authCheck.args, {
		encoding: "utf-8",
		timeout: PROVIDER_PROBE_TIMEOUT_MS,
	});
	return (provider.authCheck.okExitCodes ?? [0]).includes(result.status ?? 1);
};

export const getProviderStatuses = (): ProviderStatus[] =>
	PROVIDERS.map((provider) => {
		const installed = commandExists(provider.bin);
		const authenticated = installed ? checkAuth(provider) : false;
		return {
			provider,
			installed,
			authenticated,
			version: installed ? readVersion(provider.bin) : null,
			authHint: installed && authenticated === false ? provider.loginHint : null,
		};
	});

export const resolveProvider = (
	selection: AgentProviderSelection,
	statuses: ProviderStatus[] = getProviderStatuses(),
): ProviderStatus | null => {
	if (selection !== "auto") {
		return statuses.find((status) => status.provider.id === selection) ?? null;
	}
	return (
		statuses.find((status) => status.installed && status.authenticated !== false) ??
		statuses.find((status) => status.installed) ??
		null
	);
};
