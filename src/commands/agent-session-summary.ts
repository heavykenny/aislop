import type { ProviderStatus } from "../agents/providers.js";
import type { PublishAgentDiffResult } from "../agents/publish.js";
import type { AgentSessionRecorder } from "../agents/session.js";
import {
	renderDisplayCommandRows,
	renderDisplayRows,
	renderDisplaySection,
} from "../ui/display.js";
import { log } from "../ui/logger.js";
import type { AgentOptions, AgentScanJson } from "./agent-types.js";

export const providerSourceLabel = (options: AgentOptions): string => {
	if (options.providerSource === "cli") return "--provider flag";
	if (options.providerSource === "preference") {
		return `saved local default (${options.providerPreference ?? options.provider})`;
	}
	return "auto-detect installed provider";
};

export const printAgentSessionSummary = (input: {
	before: AgentScanJson;
	after: AgentScanJson;
	changedFiles: string[];
	applied: boolean;
	published: PublishAgentDiffResult | null;
	provider: ProviderStatus;
	options: AgentOptions;
	session: AgentSessionRecorder;
	worktreePath: string;
	originalRoot: string;
}): void => {
	log.break();
	process.stdout.write(
		`${[
			renderDisplaySection("Agent summary"),
			...renderDisplayRows(
				[
					{ label: "Provider", value: input.provider.provider.label },
					{ label: "Source", value: providerSourceLabel(input.options) },
					{ label: "Session", value: input.session.id },
					{ label: "Transcript", value: input.session.path },
					{
						label: "Score",
						value: `${input.before.score ?? "not scored"} -> ${input.after.score ?? "not scored"}`,
					},
					...(input.worktreePath !== input.originalRoot
						? [{ label: "Worktree", value: input.worktreePath }]
						: []),
				],
				{ indent: 3, labelWidth: 10 },
			),
			"",
		].join("\n")}`,
	);
	if (input.changedFiles.length === 0) {
		log.muted("No files changed.");
		return;
	}
	process.stdout.write(`${renderDisplaySection("Changed files")}\n`);
	for (const file of input.changedFiles.slice(0, 12)) {
		process.stdout.write(` - ${file}\n`);
	}
	if (input.changedFiles.length > 12) {
		process.stdout.write(` - ...and ${input.changedFiles.length - 12} more\n`);
	}
	if (input.applied) {
		log.success("Applied diff to the original worktree.");
	}
	if (input.published) {
		log.success(`Committed ${input.published.commitSha} on ${input.published.branch}.`);
		if (input.published.prUrl) log.success(`Opened PR: ${input.published.prUrl}`);
	} else if (!input.applied && input.worktreePath !== input.originalRoot) {
		process.stdout.write(
			`\n${[
				renderDisplaySection("Next"),
				...renderDisplayRows([{ label: "Review", value: input.worktreePath }]),
				...renderDisplayCommandRows([
					{ label: "Apply", command: `aislop agent apply ${input.session.id}` },
				]),
				"",
			].join("\n")}`,
		);
	}
};
