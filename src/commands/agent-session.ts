import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildRepairPrompt, selectAgentFindings } from "../agents/prompt.js";
import { formatProviderOutputLine } from "../agents/provider-output.js";
import { runProvider } from "../agents/provider-runner.js";
import type { ProviderStatus } from "../agents/providers.js";
import { type PublishAgentDiffResult, publishAgentDiff } from "../agents/publish.js";
import {
	type AgentSessionRecorder,
	createAgentSessionRecorder,
	summarizeAgentFinding,
} from "../agents/session.js";
import {
	createAgentWorktree,
	diffNameOnly,
	readBinaryDiff,
	removeAgentWorktree,
} from "../agents/worktree.js";
import type { Diagnostic } from "../engines/types.js";
import {
	renderDisplayCommandRows,
	renderDisplayRows,
	renderDisplaySection,
} from "../ui/display.js";
import { LiveRail } from "../ui/live-rail.js";
import { log } from "../ui/logger.js";
import { confirm, isCancel } from "../ui/prompts.js";
import { style, theme } from "../ui/theme.js";
import { applyDiff, runSafeFix, scanJson } from "./agent-local-cli.js";
import { type AgentOptions, type AgentScanJson, summarizeAgentScan } from "./agent-types.js";

type AgentWorktreeState = Awaited<ReturnType<typeof createAgentWorktree>>;

const renderProviderLine = (provider: string, line: string): void => {
	process.stdout.write(
		`   ${style(theme, "muted", provider.padEnd(8))} ${style(theme, "dim", line)}\n`,
	);
};

const prepareWorktree = async (
	rail: LiveRail,
	resolvedDir: string,
	options: AgentOptions,
): Promise<AgentWorktreeState> => {
	rail.start("Preparing local session");
	const created = await createAgentWorktree(resolvedDir, { inPlace: options.inPlace });
	rail.complete({
		status: "done",
		label: created.worktree.created
			? `Created worktree ${path.relative(created.state.root, created.worktree.path)}`
			: "Using current worktree",
	});
	return created;
};

const scanBaseline = (rail: LiveRail, cwd: string): AgentScanJson => {
	rail.start("Scanning baseline");
	const scan = scanJson(cwd);
	rail.complete({
		status: scan.summary.errors > 0 ? "warn" : "done",
		label: `Baseline ${scan.score ?? "not scored"} / 100 · ${scan.diagnostics.length} findings`,
	});
	return scan;
};

const runSafeFixStep = (rail: LiveRail, cwd: string, options: AgentOptions): void => {
	if (options.noFix) return;
	rail.start("Applying deterministic safe fixes");
	runSafeFix(cwd);
	rail.complete({ status: "done", label: "Safe fixer finished" });
};

const selectFindings = (rail: LiveRail, cwd: string, limit: number): Diagnostic[] => {
	rail.start("Selecting findings for agent");
	const scan = scanJson(cwd);
	const findings = selectAgentFindings(scan.diagnostics, limit);
	rail.complete({
		status: findings.length > 0 ? "done" : "skipped",
		label:
			findings.length > 0
				? `Selected ${findings.length} finding${findings.length === 1 ? "" : "s"}`
				: "No remaining agent findings",
	});
	return findings;
};

const runProviderStep = async (input: {
	rail: LiveRail;
	session: AgentSessionRecorder;
	selected: ProviderStatus;
	worktreePath: string;
	findings: Diagnostic[];
	score: number | null;
	options: AgentOptions;
}): Promise<void> => {
	if (input.findings.length === 0) {
		input.session.append("provider.skipped", {
			reason: "no_selected_findings",
			provider: input.selected.provider.id,
		});
		return;
	}
	if ((input.score ?? 0) >= input.options.targetScore) {
		input.session.append("provider.skipped", {
			reason: "target_score_met",
			provider: input.selected.provider.id,
			score: input.score,
			targetScore: input.options.targetScore,
		});
		return;
	}
	input.rail.start(`Running ${input.selected.provider.label}`);
	const prompt = buildRepairPrompt({
		rootDirectory: input.worktreePath,
		findings: input.findings,
		score: input.score,
		targetScore: input.options.targetScore,
		maxTurns: input.options.maxTurns,
	});
	input.session.append("provider.started", {
		provider: input.selected.provider.id,
		label: input.selected.provider.label,
		score: input.score,
		targetScore: input.options.targetScore,
		findings: input.findings.length,
		maxTurns: input.options.maxTurns,
	});
	input.rail.setActiveLabel(`${input.selected.provider.label} is editing`);
	const exitCode = await runProvider(input.selected.provider, {
		cwd: input.worktreePath,
		prompt,
		maxTurns: input.options.maxTurns,
		onEvent: (event) => {
			const displayLine = formatProviderOutputLine(event.line);
			if (displayLine) renderProviderLine(input.selected.provider.id, displayLine);
			input.session.append("provider.output", {
				provider: input.selected.provider.id,
				stream: event.stream,
				line: event.line,
				displayLine,
			});
		},
	});
	input.session.append("provider.finished", {
		provider: input.selected.provider.id,
		exitCode,
	});
	input.rail.complete({
		status: exitCode === 0 ? "done" : "warn",
		label: `${input.selected.provider.label} exited ${exitCode ?? "unknown"}`,
	});
};

const verifyDiff = async (
	rail: LiveRail,
	cwd: string,
	before: AgentScanJson,
): Promise<{ after: AgentScanJson; changedFiles: string[] }> => {
	rail.start("Verifying agent diff");
	const after = scanJson(cwd);
	const changedFiles = await diffNameOnly(cwd);
	rail.complete({
		status: (after.score ?? 0) >= (before.score ?? 0) && changedFiles.length > 0 ? "done" : "warn",
		label: `Verified ${before.score ?? "not scored"} → ${after.score ?? "not scored"} · ${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"} changed`,
	});
	return { after, changedFiles };
};

const maybeApplyDiff = async (input: {
	options: AgentOptions;
	changedFiles: string[];
	worktreePath: string;
	originalRoot: string;
}): Promise<boolean> => {
	if (
		input.changedFiles.length === 0 ||
		input.worktreePath === input.originalRoot ||
		!input.options.apply
	) {
		return false;
	}
	const shouldApply =
		input.options.yes ||
		(await confirm({
			message: `Apply ${input.changedFiles.length} file change${input.changedFiles.length === 1 ? "" : "s"} back to ${path.basename(input.originalRoot)}?`,
			initialValue: false,
		}));
	if (isCancel(shouldApply)) {
		log.warn("Apply cancelled. Worktree left for review.");
		return false;
	}
	if (!shouldApply) return false;
	await applyDiff(input.originalRoot, await readBinaryDiff(input.worktreePath));
	return true;
};

const printSummary = (input: {
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
					{ label: "Source", value: input.options.providerSource },
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

export const runAgentSession = async (
	selected: ProviderStatus,
	resolvedDir: string,
	options: AgentOptions,
	started: number,
): Promise<void> => {
	const rail = new LiveRail();
	let created: AgentWorktreeState | undefined;
	let session: AgentSessionRecorder | undefined;
	let changedFiles: string[] = [];
	let applied = false;
	let published: PublishAgentDiffResult | null = null;
	try {
		created = await prepareWorktree(rail, resolvedDir, options);
		session = createAgentSessionRecorder(created.state.root, {
			id: process.env.AISLOP_AGENT_SESSION_ID,
		});
		session.append("session.started", {
			root: created.state.root,
			requestedDirectory: resolvedDir,
			background: process.env.AISLOP_AGENT_BACKGROUND === "1",
			providerSelection: options.provider,
			providerSource: options.providerSource,
			providerPreference: options.providerPreference,
			provider: selected.provider.id,
			providerLabel: selected.provider.label,
			providerVersion: selected.version,
			mode: options.inPlace ? "in_place" : "isolated_worktree",
			targetScore: options.targetScore,
			maxTurns: options.maxTurns,
			limit: options.limit,
			publish: {
				commit: options.commit,
				pr: options.pr,
				branch: options.branch,
				base: options.base,
				ready: options.ready,
			},
		});
		session.append("worktree.prepared", {
			path: created.worktree.path,
			created: created.worktree.created,
			branch: created.state.branch,
			head: created.state.head,
		});
		const before = scanBaseline(rail, created.worktree.path);
		session.append("scan.baseline", summarizeAgentScan(before));
		runSafeFixStep(rail, created.worktree.path, options);
		const afterFix = scanJson(created.worktree.path);
		session.append(options.noFix ? "fix.safe.skipped" : "fix.safe.finished", {
			scan: summarizeAgentScan(afterFix),
		});
		const findings = selectFindings(rail, created.worktree.path, options.limit);
		session.append("findings.selected", {
			count: findings.length,
			findings: findings.map(summarizeAgentFinding),
		});
		await runProviderStep({
			rail,
			session,
			selected,
			worktreePath: created.worktree.path,
			findings,
			score: afterFix.score,
			options,
		});
		const verified = await verifyDiff(rail, created.worktree.path, before);
		changedFiles = verified.changedFiles;
		session.append("diff.verified", {
			scan: summarizeAgentScan(verified.after),
			changedFiles,
		});
		applied = await maybeApplyDiff({
			options,
			changedFiles,
			worktreePath: created.worktree.path,
			originalRoot: created.state.root,
		});
		session.append(applied ? "diff.applied" : "diff.apply_skipped", {
			applyRequested: options.apply,
			changedFiles: changedFiles.length,
		});
		if (changedFiles.length > 0 && (options.commit || options.pr)) {
			rail.start(options.pr ? "Creating local branch and PR" : "Creating local commit");
			session.append("publish.started", {
				commit: options.commit,
				pr: options.pr,
				branch: options.branch,
				base: options.base,
				ready: options.ready,
			});
			published = await publishAgentDiff({
				cwd: created.worktree.path,
				originalBranch: created.state.branch,
				providerId: selected.provider.id,
				beforeScore: before.score,
				afterScore: verified.after.score,
				changedFiles,
				options: {
					commit: options.commit,
					pr: options.pr,
					branch: options.branch,
					base: options.base,
					commitMessage: options.commitMessage,
					prTitle: options.prTitle,
					ready: options.ready,
				},
			});
			session.append(published ? "publish.finished" : "publish.skipped", {
				result: published,
			});
			rail.complete({
				status: published ? "done" : "skipped",
				label: published?.prUrl
					? `Opened PR ${published.prUrl}`
					: published
						? `Committed ${published.commitSha}`
						: "No commit created",
			});
		} else if (options.commit || options.pr) {
			session.append("publish.skipped", {
				reason: "no_changed_files",
				commit: options.commit,
				pr: options.pr,
			});
		}
		session.append("session.completed", {
			durationMs: Math.round(performance.now() - started),
			scoreBefore: before.score,
			scoreAfter: verified.after.score,
			changedFiles: changedFiles.length,
			applied,
			published: Boolean(published),
		});
		rail.finish({
			footer: `Done · ${selected.provider.id} · ${Math.round(performance.now() - started)}ms`,
		});
		printSummary({
			before,
			after: verified.after,
			changedFiles,
			applied,
			published,
			provider: selected,
			options,
			session,
			worktreePath: created.worktree.path,
			originalRoot: created.state.root,
		});
	} catch (error) {
		session?.append("session.failed", {
			message: error instanceof Error ? error.message : String(error),
		});
		rail.abort();
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	} finally {
		const safeToCleanup =
			changedFiles.length === 0 || applied || Boolean(published) || options.cleanup;
		if (
			created?.worktree.created &&
			!options.keepWorktree &&
			safeToCleanup &&
			process.exitCode !== 1
		) {
			await removeAgentWorktree(created.worktree);
			session?.append("worktree.removed", { path: created.worktree.path });
		}
	}
};
