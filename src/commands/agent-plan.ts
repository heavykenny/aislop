import path from "node:path";
import { selectAgentFindings } from "../agents/prompt.js";
import { resolveAgentProviderSelection } from "../agents/provider-preference.js";
import {
	getProviderStatuses,
	type ProviderStatus,
	providerIds,
	resolveProvider,
} from "../agents/providers.js";
import type { Diagnostic } from "../engines/types.js";
import { renderDisplayRows, renderDisplaySection } from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { log } from "../ui/logger.js";
import { runSubprocess } from "../utils/subprocess.js";
import { APP_VERSION } from "../version.js";
import { scanJson } from "./agent-local-cli.js";
import type { AgentOptions, AgentScanJson } from "./agent-types.js";

interface AgentPlanGitState {
	root: string;
	branch: string | null;
	head: string;
	dirty: boolean;
}

interface AgentPlan {
	directory: string;
	git: AgentPlanGitState;
	provider: ProviderStatus | null;
	scan: AgentScanJson;
	findings: Diagnostic[];
	blockers: string[];
	options: AgentOptions;
}

const readGitPlanState = async (directory: string): Promise<AgentPlanGitState> => {
	const rootResult = await runSubprocess("git", ["rev-parse", "--show-toplevel"], {
		cwd: path.resolve(directory),
	});
	if (rootResult.exitCode !== 0 || !rootResult.stdout.trim()) {
		throw new Error("aislop agent plan needs to run inside a git repository.");
	}
	const root = rootResult.stdout.trim();
	const [branch, head, status] = await Promise.all([
		runSubprocess("git", ["branch", "--show-current"], { cwd: root }),
		runSubprocess("git", ["rev-parse", "--short", "HEAD"], { cwd: root }),
		runSubprocess("git", ["status", "--porcelain"], { cwd: root }),
	]);
	return {
		root,
		branch: branch.stdout.trim() || null,
		head: head.stdout.trim(),
		dirty: status.stdout.trim().length > 0,
	};
};

export const buildAgentPlanBlockers = (input: {
	git: AgentPlanGitState;
	provider: ProviderStatus | null;
	options: AgentOptions;
}): string[] => {
	const blockers: string[] = [];
	if (!input.provider || !input.provider.installed) {
		blockers.push(
			`No usable provider found. Installed providers: ${
				getProviderStatuses()
					.filter((status) => status.installed)
					.map((status) => status.provider.id)
					.join(", ") || "none"
			}.`,
		);
	} else if (input.provider.authenticated === false) {
		blockers.push(`${input.provider.provider.label} is installed but not authenticated.`);
	}
	if (!input.options.inPlace && input.git.dirty) {
		blockers.push(
			"Isolated worktree mode needs a clean checkout. Commit/stash changes or use --in-place.",
		);
	}
	if (input.options.background && input.options.apply && !input.options.yes) {
		blockers.push("Background apply cannot prompt. Use --apply --yes.");
	}
	return blockers;
};

const providerText = (provider: ProviderStatus | null): string => {
	if (!provider) return "none selected";
	const state = provider.installed
		? provider.authenticated === false
			? "auth needed"
			: "ready"
		: "not installed";
	return `${provider.provider.label} (${state}${provider.version ? `, ${provider.version}` : ""})`;
};

const providerSourceText = (options: AgentOptions): string => {
	if (options.providerSource === "cli") return "--provider flag";
	if (options.providerSource === "preference") {
		return `saved local default (${options.providerPreference ?? options.provider})`;
	}
	return "auto-detect installed provider";
};

const actionRows = (plan: AgentPlan): Array<{ label: string; value: string }> => {
	const rows = [
		{
			label: "Worktree",
			value: plan.options.inPlace ? "edit current checkout" : "create isolated git worktree",
		},
		{ label: "Safe fixes", value: plan.options.noFix ? "skip" : "run before provider handoff" },
		{
			label: "Provider",
			value:
				plan.findings.length === 0 || (plan.scan.score ?? 0) >= plan.options.targetScore
					? "skip; target already met or no selected findings"
					: `run ${plan.provider?.provider.label ?? "selected provider"} with ${plan.findings.length} finding${plan.findings.length === 1 ? "" : "s"}`,
		},
		{
			label: "Session",
			value: plan.options.background ? "background transcript" : "foreground streaming session",
		},
		{
			label: "Apply",
			value: plan.options.apply
				? "apply verified diff back to original checkout"
				: "leave diff in worktree",
		},
		{
			label: "Publish",
			value: plan.options.pr
				? `commit, push, and open ${plan.options.ready ? "ready" : "draft"} PR`
				: plan.options.commit
					? "commit on an agent branch"
					: "no commit or PR",
		},
	];
	if (plan.options.commit || plan.options.pr) {
		rows.push({ label: "Commit message", value: plan.options.commitMessage });
		if (plan.options.branch) rows.push({ label: "Branch", value: plan.options.branch });
		if (plan.options.base) rows.push({ label: "Base", value: plan.options.base });
		if (plan.options.prTitle) rows.push({ label: "PR title", value: plan.options.prTitle });
	}
	return rows;
};

const findingLine = (diagnostic: Diagnostic): string =>
	`${diagnostic.filePath}:${diagnostic.line} ${diagnostic.rule} (${diagnostic.severity})`;

export const renderAgentPlan = (plan: AgentPlan): string => {
	const lines = [
		renderHeader({
			version: APP_VERSION,
			command: "Agent plan",
			context: [plan.options.provider],
		}).trimEnd(),
		"",
		renderDisplaySection("Context"),
		...renderDisplayRows(
			[
				{ label: "Directory", value: plan.directory },
				{ label: "Repo", value: plan.git.root },
				{
					label: "Branch",
					value: `${plan.git.branch ?? "detached"} @ ${plan.git.head || "unknown"}`,
				},
				{ label: "Checkout", value: plan.git.dirty ? "dirty" : "clean" },
				{ label: "Provider", value: providerText(plan.provider) },
				{ label: "Source", value: providerSourceText(plan.options) },
				{
					label: "Score",
					value: `${plan.scan.score ?? "not scored"} / 100 (${plan.scan.diagnostics.length} findings)`,
				},
				{ label: "Target", value: `${plan.options.targetScore} / 100` },
			],
			{ indent: 3, labelWidth: 9 },
		),
		"",
		renderDisplaySection("Actions"),
		...renderDisplayRows(actionRows(plan), { indent: 3, labelWidth: 14 }),
	];
	if (plan.findings.length > 0) {
		lines.push("", renderDisplaySection("Selected findings"));
		for (const finding of plan.findings.slice(0, 8)) lines.push(` - ${findingLine(finding)}`);
		if (plan.findings.length > 8) lines.push(` - ...and ${plan.findings.length - 8} more`);
	} else {
		lines.push("", renderDisplaySection("Selected findings"), " - none");
	}
	lines.push(
		"",
		renderDisplaySection(plan.blockers.length > 0 ? "Blockers" : "Ready"),
		...(plan.blockers.length > 0
			? plan.blockers.map((blocker) => ` - ${blocker}`)
			: [" - No blockers found."]),
		"",
		renderDisplaySection("Notes"),
		...renderDisplayRows(
			[
				{
					label: "False positives",
					value:
						"provider prompt asks the agent to leave likely false positives unchanged and explain why.",
				},
			],
			{ indent: 3, labelWidth: 15 },
		),
	);
	return `${lines.join("\n")}\n`;
};

export const agentPlanCommand = async (directory: string, options: AgentOptions): Promise<void> => {
	try {
		const requestedDirectory = path.resolve(directory);
		const git = await readGitPlanState(directory);
		const providerChoice = resolveAgentProviderSelection({
			root: git.root,
			requested: options.provider,
			explicit: options.providerSource === "cli",
		});
		const resolvedOptions: AgentOptions = {
			...options,
			provider: providerChoice.selection,
			providerSource: providerChoice.source,
			providerPreference: providerChoice.preference?.provider,
		};
		const statuses = getProviderStatuses();
		const provider = resolveProvider(resolvedOptions.provider, statuses);
		const scan = scanJson(requestedDirectory);
		const findings = selectAgentFindings(scan.diagnostics, resolvedOptions.limit);
		const plan: AgentPlan = {
			directory: requestedDirectory,
			git,
			provider,
			scan,
			findings,
			options: resolvedOptions,
			blockers: buildAgentPlanBlockers({ git, provider, options: resolvedOptions }),
		};
		process.stdout.write(renderAgentPlan(plan));
		if (!provider) log.muted(`Supported providers: ${providerIds().join(", ")}`);
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
};
