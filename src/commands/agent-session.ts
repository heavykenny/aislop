import path from "node:path";
import { performance } from "node:perf_hooks";
import { selectAgentFindings } from "../agents/prompt.js";
import type { ProviderStatus } from "../agents/providers.js";
import { type PublishAgentDiffResult, publishAgentDiff } from "../agents/publish.js";
import {
	type AgentSessionRecorder,
	createAgentSessionRecorder,
	summarizeAgentFinding,
} from "../agents/session.js";
import {
	createChangedFileTracker,
	createSessionStats,
	createUsageTotals,
} from "../agents/session-activity.js";
import { createAgentWorktree, removeAgentWorktree } from "../agents/worktree.js";
import type { Diagnostic } from "../engines/types.js";
import { AgentTui } from "../ui/agent-tui.js";
import { log } from "../ui/logger.js";
import { runSafeFix, scanJson } from "./agent-local-cli.js";
import {
	maybeApplyDiff,
	maybeContinueSession,
	runProviderStep,
	verifyDiff,
} from "./agent-session-steps.js";
import { printAgentSessionSummary, providerSourceLabel } from "./agent-session-summary.js";
import { type AgentOptions, type AgentScanJson, summarizeAgentScan } from "./agent-types.js";

type AgentWorktreeState = Awaited<ReturnType<typeof createAgentWorktree>>;

export interface AgentSessionRunTelemetry {
	[key: string]: unknown;
	agent_result: "completed" | "no_agent_findings" | "failed";
	score_before?: number | null;
	score_after?: number | null;
	score_delta?: number;
	changed_files?: number;
	provider_passes?: number;
	tool_calls?: number;
	output_events?: number;
	total_tokens?: number;
	cost_usd?: number;
	applied?: boolean;
	published?: boolean;
	target_met?: boolean;
}

const scoreDelta = (before: number | null, after: number | null): number | undefined =>
	typeof before === "number" && typeof after === "number" ? after - before : undefined;

export const resolveAgentSessionCwd = (
	created: AgentWorktreeState,
	requestedDirectory: string,
): string => {
	const relative = path.relative(created.state.root, requestedDirectory);
	const outsideRoot =
		relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
	if (relative.length === 0 || outsideRoot) {
		return created.worktree.path;
	}
	return path.resolve(created.worktree.path, relative);
};

const prepareWorktree = async (
	tui: AgentTui,
	resolvedDir: string,
	options: AgentOptions,
): Promise<AgentWorktreeState> => {
	tui.start("Preparing local session");
	const created = await createAgentWorktree(resolvedDir, { inPlace: options.inPlace });
	tui.setMetric(
		"Worktree",
		created.worktree.created ? path.relative(created.state.root, created.worktree.path) : "current",
	);
	tui.complete({
		status: "done",
		label: created.worktree.created
			? `Created worktree ${path.relative(created.state.root, created.worktree.path)}`
			: "Using current worktree",
	});
	return created;
};

const scanBaseline = (tui: AgentTui, cwd: string): AgentScanJson => {
	tui.start("Scanning baseline");
	const scan = scanJson(cwd);
	tui.setMetric("Score", `${scan.score ?? "not scored"} -> ...`);
	tui.setMetric("Findings", scan.diagnostics.length);
	tui.complete({
		status: scan.summary.errors > 0 ? "warn" : "done",
		label: `Baseline ${scan.score ?? "not scored"} / 100 · ${scan.diagnostics.length} findings`,
	});
	return scan;
};

const runSafeFixStep = (tui: AgentTui, cwd: string, options: AgentOptions): void => {
	if (options.noFix) return;
	tui.start("Applying deterministic safe fixes");
	runSafeFix(cwd);
	tui.complete({ status: "done", label: "Safe fixer finished" });
};

const selectFindings = (tui: AgentTui, cwd: string, limit: number, pass: number): Diagnostic[] => {
	tui.start(`Pass ${pass}: selecting findings`);
	const scan = scanJson(cwd);
	const findings = selectAgentFindings(scan.diagnostics, limit);
	tui.setMetric("Selected", findings.length);
	tui.complete({
		status: findings.length > 0 ? "done" : "skipped",
		label:
			findings.length > 0
				? `Pass ${pass}: selected ${findings.length} finding${findings.length === 1 ? "" : "s"}`
				: "No remaining agent findings",
	});
	return findings;
};

export const runAgentSession = async (
	selected: ProviderStatus,
	resolvedDir: string,
	options: AgentOptions,
	started: number,
): Promise<AgentSessionRunTelemetry | null> => {
	const tui = new AgentTui({
		provider: selected.provider.label,
		source: providerSourceLabel(options),
		directory: resolvedDir,
		mode: options.inPlace ? "current worktree" : "isolated git worktree",
		targetScore: options.targetScore,
	});
	let created: AgentWorktreeState | undefined;
	let session: AgentSessionRecorder | undefined;
	let changedFiles: string[] = [];
	let applied = false;
	let published: PublishAgentDiffResult | null = null;
	try {
		created = await prepareWorktree(tui, resolvedDir, options);
		const sessionCwd = resolveAgentSessionCwd(created, resolvedDir);
		session = createAgentSessionRecorder(created.state.root, {
			id: process.env.AISLOP_AGENT_SESSION_ID,
		});
		const usage = createUsageTotals();
		const tracker = createChangedFileTracker({
			cwd: created.worktree.path,
			session,
			onChange: (files) => {
				tui.setFiles(files);
			},
		});
		tui.setMetric("Session", session.id);
		const stats = createSessionStats();
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
			sessionCwd,
			created: created.worktree.created,
			branch: created.state.branch,
			head: created.state.head,
		});
		const before = scanBaseline(tui, sessionCwd);
		session.append("scan.baseline", summarizeAgentScan(before));
		runSafeFixStep(tui, sessionCwd, options);
		await tracker.refresh("safe fix");
		const afterFix = scanJson(sessionCwd);
		tui.setMetric("Score", `${before.score ?? "not scored"} -> ${afterFix.score ?? "not scored"}`);
		session.append(options.noFix ? "fix.safe.skipped" : "fix.safe.finished", {
			scan: summarizeAgentScan(afterFix),
		});
		let pass = 1;
		const findings = selectFindings(tui, sessionCwd, options.limit, pass);
		session.append("findings.selected", {
			pass,
			count: findings.length,
			findings: findings.map(summarizeAgentFinding),
		});
		// No findings for the agent (LLM). If the deterministic safe fix already
		// changed files, fall through so those changes get applied; only short-circuit
		// when nothing changed at all (otherwise the safe fix would be discarded).
		if (findings.length === 0 && tracker.files().length === 0) {
			session.append("session.completed", {
				durationMs: Math.round(performance.now() - started),
				scoreBefore: before.score,
				scoreAfter: afterFix.score,
				reason: "no_agent_findings",
			});
			const atTarget = (afterFix.score ?? 0) >= options.targetScore;
			await tui.finish({ footer: `Score ${afterFix.score ?? "?"}/100 · nothing to repair` });
			log.success(
				atTarget
					? `Already at ${afterFix.score ?? "?"}/100 — nothing to do.`
					: `Score ${afterFix.score ?? "?"}/100. No agent-fixable findings; run \`aislop fix\` for any auto-fixable issues.`,
			);
			return {
				agent_result: "no_agent_findings",
				score_before: before.score,
				score_after: afterFix.score,
				score_delta: scoreDelta(before.score, afterFix.score),
				changed_files: tracker.files().length,
				provider_passes: 0,
				tool_calls: 0,
				output_events: 0,
				total_tokens: 0,
				cost_usd: 0,
				applied: false,
				published: false,
				target_met: atTarget,
			};
		}
		await runProviderStep({
			tui,
			session,
			selected,
			worktreePath: sessionCwd,
			diffRoot: created.worktree.path,
			findings,
			score: afterFix.score,
			options,
			usage,
			stats,
			tracker,
			pass,
		});
		let verified = await verifyDiff(
			tui,
			sessionCwd,
			before,
			options,
			session,
			pass,
			afterFix.score,
		);
		while (
			await maybeContinueSession({
				tui,
				session,
				scan: verified.after,
				changedFiles: verified.changedFiles,
				options,
				usage,
				stats,
				files: tracker.files(),
				nextPass: pass + 1,
				originalRoot: created.state.root,
			})
		) {
			pass += 1;
			const passStartScore = verified.after.score;
			const nextFindings = selectFindings(tui, sessionCwd, options.limit, pass);
			session.append("findings.selected", {
				pass,
				count: nextFindings.length,
				findings: nextFindings.map(summarizeAgentFinding),
				source: "continue",
			});
			await runProviderStep({
				tui,
				session,
				selected,
				worktreePath: sessionCwd,
				diffRoot: created.worktree.path,
				findings: nextFindings,
				score: verified.after.score,
				options,
				usage,
				stats,
				tracker,
				pass,
			});
			verified = await verifyDiff(tui, sessionCwd, before, options, session, pass, passStartScore);
		}
		changedFiles = verified.changedFiles;
		applied = await maybeApplyDiff({
			options,
			changedFiles,
			worktreePath: created.worktree.path,
			originalRoot: created.state.root,
			tui,
			session,
			usage,
			stats,
			files: tracker.files(),
		});
		session.append(applied ? "diff.applied" : "diff.apply_skipped", {
			applyRequested: options.apply,
			changedFiles: changedFiles.length,
		});
		if (changedFiles.length > 0 && (options.commit || options.pr)) {
			tui.start(options.pr ? "Creating local branch and PR" : "Creating local commit");
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
			tui.complete({
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
			providerPasses: stats.providerPasses,
			toolCalls: stats.toolCalls,
			outputEvents: stats.outputEvents,
			totalTokens: usage.totalTokens,
			costUsd: usage.costUsd,
			applied,
			published: Boolean(published),
		});
		await tui.finish({
			footer: `Done · ${selected.provider.id} · ${Math.round(performance.now() - started)}ms`,
		});
		printAgentSessionSummary({
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
			usage,
			stats,
			fileActivity: tracker.files(),
		});
		return {
			agent_result: "completed",
			score_before: before.score,
			score_after: verified.after.score,
			score_delta: scoreDelta(before.score, verified.after.score),
			changed_files: changedFiles.length,
			provider_passes: stats.providerPasses,
			tool_calls: stats.toolCalls,
			output_events: stats.outputEvents,
			total_tokens: usage.totalTokens,
			cost_usd: usage.costUsd,
			applied,
			published: Boolean(published),
			target_met: verified.after.score !== null && verified.after.score >= options.targetScore,
		};
	} catch (error) {
		session?.append("session.failed", {
			message: error instanceof Error ? error.message : String(error),
		});
		await tui.abort();
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
		return { agent_result: "failed" };
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
