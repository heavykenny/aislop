import type { Diagnostic } from "../engines/types.js";
import type { AgentProviderSelectionSource } from "../agents/provider-preference.js";
import type { AgentProviderId, AgentProviderSelection } from "../agents/providers.js";

export interface AgentOptions {
	provider: AgentProviderSelection;
	providerSource: AgentProviderSelectionSource;
	providerPreference?: AgentProviderId;
	targetScore: number;
	maxTurns: number;
	limit: number;
	inPlace: boolean;
	keepWorktree: boolean;
	apply: boolean;
	yes: boolean;
	dryRun: boolean;
	background: boolean;
	noFix: boolean;
	cleanup: boolean;
	commit: boolean;
	pr: boolean;
	branch?: string;
	base?: string;
	commitMessage: string;
	prTitle?: string;
	ready: boolean;
}

export interface AgentScanJson {
	score: number | null;
	label: string;
	diagnostics: Diagnostic[];
	summary: {
		errors: number;
		warnings: number;
		fixable: number;
		files: number;
	};
}

export const summarizeAgentScan = (scan: AgentScanJson): Record<string, unknown> => ({
	score: scan.score,
	label: scan.label,
	diagnostics: scan.diagnostics.length,
	summary: scan.summary,
});
