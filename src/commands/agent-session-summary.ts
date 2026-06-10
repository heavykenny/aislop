import type { ProviderStatus } from "../agents/providers.js";
import type { PublishAgentDiffResult } from "../agents/publish.js";
import type { AgentSessionRecorder } from "../agents/session.js";
import pc from "picocolors";
import {
	type AgentSessionStats,
	type AgentUsageTotals,
	type EditedFileActivity,
	formatToolCalls,
	formatUsageTotals,
} from "../agents/session-activity.js";
import {
	renderDisplayCommandRows,
	renderDisplayRows,
	renderDisplaySection,
} from "../ui/display.js";
import { log } from "../ui/logger.js";
import { displayAgentPath } from "./agent-display-path.js";
import type { AgentOptions, AgentScanJson } from "./agent-types.js";

export const providerSourceLabel = (options: AgentOptions): string => {
	if (options.providerSource === "cli") return "--provider flag";
	if (options.providerSource === "preference") {
		return `saved local default (${options.providerPreference ?? options.provider})`;
	}
	return "auto-detect installed provider";
};

const actionableCount = (scan: AgentScanJson): number =>
	scan.diagnostics.filter((diagnostic) => diagnostic.severity !== "info").length;

const coloredDiffStat = (file: EditedFileActivity): string => {
	if (file.binary) return pc.dim("binary");
	if (typeof file.additions === "number" || typeof file.deletions === "number") {
		return `${pc.green(`+${file.additions ?? 0}`)} ${pc.red(`-${file.deletions ?? 0}`)}`;
	}
	return pc.dim("changed");
};

const editedFileLine = (file: EditedFileActivity): string =>
	`${file.filePath} · ${coloredDiffStat(file)}`;

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
	usage: AgentUsageTotals;
	stats: AgentSessionStats;
	fileActivity: EditedFileActivity[];
}): void => {
	const editedFileCount = input.fileActivity.length || input.changedFiles.length;
	const statsByFile = new Map(input.fileActivity.map((file) => [file.filePath, file]));
	log.break();
	process.stdout.write(
		`${[
			renderDisplaySection("Agent summary"),
			...renderDisplayRows(
				[
					{ label: "Provider", value: input.provider.provider.label },
					{ label: "Source", value: providerSourceLabel(input.options) },
					{ label: "Session", value: input.session.id },
					{ label: "Transcript", value: displayAgentPath(input.originalRoot, input.session.path) },
					{
						label: "Score",
						value: `${input.before.score ?? "not scored"} -> ${input.after.score ?? "not scored"}`,
					},
					{ label: "Remaining", value: `${actionableCount(input.after)} actionable findings` },
					{ label: "Passes", value: String(input.stats.providerPasses) },
					{ label: "Tools", value: formatToolCalls(input.stats.toolCalls) },
					{ label: "Tokens", value: formatUsageTotals(input.usage) },
					{ label: "Files edited", value: String(editedFileCount) },
					{ label: "Changed", value: String(input.changedFiles.length) },
					...(input.worktreePath !== input.originalRoot
						? [
								{
									label: "Worktree",
									value: displayAgentPath(input.originalRoot, input.worktreePath),
								},
							]
						: []),
				],
				{ indent: 3, labelWidth: 12 },
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
		const stat = statsByFile.get(file);
		process.stdout.write(` - ${stat ? editedFileLine(stat) : file}\n`);
	}
	if (input.changedFiles.length > 12) {
		process.stdout.write(` - ...and ${input.changedFiles.length - 12} more\n`);
	}
	if (input.fileActivity.length > 0) {
		process.stdout.write(`\n${renderDisplaySection("File activity")}\n`);
		for (const file of input.fileActivity.slice(-8)) {
			process.stdout.write(` - ${editedFileLine(file)}\n`);
		}
		if (input.fileActivity.length > 8) {
			process.stdout.write(` - ...and ${input.fileActivity.length - 8} more\n`);
		}
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
				...renderDisplayRows([
					{ label: "Review", value: displayAgentPath(input.originalRoot, input.worktreePath) },
				]),
				...renderDisplayCommandRows([
					{ label: "Apply", command: `aislop agent apply ${input.session.id}` },
				]),
				"",
			].join("\n")}`,
		);
	}
};
