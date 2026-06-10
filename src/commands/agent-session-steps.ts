import path from "node:path";
import { buildRepairPrompt, selectAgentFindings } from "../agents/prompt.js";
import { extractProviderOutputMetadata } from "../agents/provider-metadata.js";
import { formatProviderOutputLine } from "../agents/provider-output.js";
import { runProvider } from "../agents/provider-runner.js";
import type { ProviderStatus } from "../agents/providers.js";
import type { AgentSessionRecorder } from "../agents/session.js";
import {
	type AgentSessionStats,
	type AgentUsageTotals,
	type createChangedFileTracker,
	type EditedFileActivity,
	formatToolCalls,
	formatUsageTotals,
	isProviderToolLine,
	mergeProviderUsage,
} from "../agents/session-activity.js";
import { diffNameOnly, readBinaryDiff } from "../agents/worktree.js";
import type { Diagnostic } from "../engines/types.js";
import type { AgentTui } from "../ui/agent-tui.js";
import { applyDiff, scanJson } from "./agent-local-cli.js";
import { type AgentOptions, type AgentScanJson, summarizeAgentScan } from "./agent-types.js";

const plural = (count: number, singular: string, pluralLabel = `${singular}s`): string =>
	`${count.toLocaleString()} ${count === 1 ? singular : pluralLabel}`;

export const runProviderStep = async (input: {
	tui: AgentTui;
	session: AgentSessionRecorder;
	selected: ProviderStatus;
	worktreePath: string;
	diffRoot: string;
	findings: Diagnostic[];
	score: number | null;
	options: AgentOptions;
	usage: AgentUsageTotals;
	stats: AgentSessionStats;
	tracker: ReturnType<typeof createChangedFileTracker>;
	pass: number;
}): Promise<void> => {
	if (input.findings.length === 0) {
		input.session.append("provider.skipped", {
			reason: "no_selected_findings",
			provider: input.selected.provider.id,
		});
		return;
	}
	input.stats.providerPasses = Math.max(input.stats.providerPasses, input.pass);
	input.tui.setMetric("Pass", input.pass);
	input.tui.start(`Pass ${input.pass}: running ${input.selected.provider.label}`);
	input.tui.setMetric("Tokens", "waiting");
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
		pass: input.pass,
		score: input.score,
		targetScore: input.options.targetScore,
		findings: input.findings.length,
		maxTurns: input.options.maxTurns,
	});
	input.tui.setActiveLabel(`Pass ${input.pass}: ${input.selected.provider.label} is editing`);
	input.tracker.start();
	let exitCode: number | null = null;
	let passToolCalls = 0;
	let passOutputEvents = 0;
	try {
		exitCode = await runProvider(input.selected.provider, {
			cwd: input.worktreePath,
			prompt,
			maxTurns: input.options.maxTurns,
			onEvent: (event) => {
				passOutputEvents += 1;
				input.stats.outputEvents += 1;
				const displayLine = formatProviderOutputLine(event.line);
				if (displayLine) {
					input.tui.appendLog(input.selected.provider.id, displayLine);
					if (isProviderToolLine(displayLine)) {
						passToolCalls += 1;
						input.stats.toolCalls += 1;
						input.tui.setMetric("Tools", input.stats.toolCalls);
					}
				}
				const metadata = extractProviderOutputMetadata(event.line);
				if (metadata.usage) {
					Object.assign(input.usage, mergeProviderUsage(input.usage, metadata.usage));
					input.tui.setMetric("Tokens", formatUsageTotals(input.usage));
					input.tui.setUsage({
						inputTokens: input.usage.inputTokens,
						totalTokens: input.usage.totalTokens,
						costUsd: input.usage.costUsd,
					});
					input.session.append("provider.usage", {
						provider: input.selected.provider.id,
						usage: input.usage,
					});
				}
				for (const filePath of metadata.files) {
					const absolutePath = path.isAbsolute(filePath)
						? filePath
						: path.resolve(input.worktreePath, filePath);
					const relativePath = path.relative(input.diffRoot, absolutePath);
					input.tracker.noteFile(
						relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
							? relativePath
							: filePath,
						`${input.selected.provider.id} output`,
					);
				}
				input.session.append("provider.output", {
					provider: input.selected.provider.id,
					stream: event.stream,
					line: event.line,
					displayLine,
				});
			},
		});
	} catch (error) {
		input.session.append("provider.failed", {
			provider: input.selected.provider.id,
			pass: input.pass,
			message: error instanceof Error ? error.message : String(error),
		});
		input.tui.complete({
			status: "failed",
			label: `Pass ${input.pass}: ${input.selected.provider.label} failed`,
		});
		throw error;
	} finally {
		await input.tracker.stop();
	}
	input.session.append("provider.finished", {
		provider: input.selected.provider.id,
		pass: input.pass,
		exitCode,
		toolCalls: passToolCalls,
		outputEvents: passOutputEvents,
	});
	const toolSuffix = passToolCalls > 0 ? ` · ${formatToolCalls(passToolCalls)}` : "";
	input.tui.complete({
		status: exitCode === 0 ? "done" : "warn",
		label:
			exitCode === 0
				? `Pass ${input.pass}: ${input.selected.provider.label} finished${toolSuffix}`
				: `Pass ${input.pass}: ${input.selected.provider.label} finished with exit ${exitCode ?? "unknown"}${toolSuffix}`,
	});
};

const actionableFindings = (scan: AgentScanJson): Diagnostic[] =>
	scan.diagnostics.filter((diagnostic) => diagnostic.severity !== "info");

const needsAnotherPass = (scan: AgentScanJson): boolean => actionableFindings(scan).length > 0;

const actionsForSession = (input: {
	scan: AgentScanJson;
	changedFiles: string[];
	options: AgentOptions;
}): string[] => {
	const actions: string[] = [];
	const remaining = actionableFindings(input.scan).length;
	if (remaining > 0) {
		actions.push(
			`Continue: ${remaining} actionable finding${remaining === 1 ? "" : "s"} remain; target is ${input.options.targetScore}/100`,
		);
	}
	if (input.changedFiles.length > 0 && !input.options.inPlace) {
		actions.push("Apply: accept the reviewed diff back into the original worktree");
	}
	if (input.changedFiles.length > 0) {
		actions.push(
			`Review: ${input.changedFiles.length} changed file${input.changedFiles.length === 1 ? "" : "s"}`,
		);
	}
	return actions;
};

export const verifyDiff = async (
	tui: AgentTui,
	cwd: string,
	before: AgentScanJson,
	options: AgentOptions,
	session: AgentSessionRecorder,
	pass: number,
	passStartScore: number | null,
): Promise<{ after: AgentScanJson; changedFiles: string[] }> => {
	tui.start(`Pass ${pass}: verifying diff`);
	const after = scanJson(cwd);
	const changedFiles = await diffNameOnly(cwd);
	tui.setMetric("Score", `${before.score ?? "not scored"} -> ${after.score ?? "not scored"}`);
	tui.setMetric("Changes", changedFiles.length);
	tui.setMetric("Remaining", actionableFindings(after).length);
	tui.setActions(actionsForSession({ scan: after, changedFiles, options }));
	session.append("diff.verified", {
		pass,
		scoreBefore: passStartScore,
		scan: summarizeAgentScan(after),
		changedFiles,
	});
	tui.complete({
		status: (after.score ?? 0) >= (before.score ?? 0) && changedFiles.length > 0 ? "done" : "warn",
		label: `Pass ${pass} verified · ${passStartScore ?? "not scored"} -> ${after.score ?? "not scored"} · ${plural(changedFiles.length, "file")} changed`,
	});
	return { after, changedFiles };
};

export const maybeContinueSession = async (input: {
	tui: AgentTui;
	session: AgentSessionRecorder;
	scan: AgentScanJson;
	changedFiles: string[];
	options: AgentOptions;
	usage: AgentUsageTotals;
	stats: AgentSessionStats;
	files: EditedFileActivity[];
	nextPass: number;
	originalRoot: string;
}): Promise<boolean> => {
	if (!needsAnotherPass(input.scan)) return false;
	const findings = selectAgentFindings(input.scan.diagnostics, input.options.limit);
	if (findings.length === 0 || !process.stdin.isTTY) return false;
	const remaining = actionableFindings(input.scan).length;
	input.session.append("continue.prompted", {
		nextPass: input.nextPass,
		score: input.scan.score,
		diagnostics: input.scan.diagnostics.length,
		actionableFindings: remaining,
		targetScore: input.options.targetScore,
	});
	const choice = await input.tui.askDecision(`Next step for pass ${input.nextPass}`, [
		{
			value: "continue",
			label: `Run pass ${input.nextPass} (${findings.length} selected findings)`,
		},
		{ value: "stop", label: "Stop and review/apply current diff" },
	]);
	const accepted = choice === "continue";
	input.session.append(accepted ? "continue.accepted" : "continue.skipped", {
		nextPass: input.nextPass,
		score: input.scan.score,
		diagnostics: input.scan.diagnostics.length,
		actionableFindings: remaining,
		selectedFindings: findings.length,
	});
	return accepted;
};

export const maybeApplyDiff = async (input: {
	options: AgentOptions;
	changedFiles: string[];
	worktreePath: string;
	originalRoot: string;
	tui: AgentTui;
	session: AgentSessionRecorder;
	usage: AgentUsageTotals;
	stats: AgentSessionStats;
	files: EditedFileActivity[];
}): Promise<boolean> => {
	if (input.changedFiles.length === 0 || input.worktreePath === input.originalRoot) {
		return false;
	}
	if (input.options.apply && input.options.yes) {
		await applyDiff(input.originalRoot, await readBinaryDiff(input.worktreePath));
		return true;
	}
	if (!process.stdin.isTTY) return false;
	input.session.append("apply.prompted", {
		changedFiles: input.changedFiles.length,
		editedFiles: input.files.length || input.changedFiles.length,
	});
	const choice = await input.tui.askDecision(
		`Next step for ${plural(input.changedFiles.length, "changed file")}`,
		[
			{ value: "apply", label: `Apply changes to ${path.basename(input.originalRoot)}` },
			{ value: "review", label: "Keep worktree for review" },
		],
	);
	if (choice !== "apply") {
		input.session.append("apply.declined");
		return false;
	}
	await applyDiff(input.originalRoot, await readBinaryDiff(input.worktreePath));
	return true;
};
