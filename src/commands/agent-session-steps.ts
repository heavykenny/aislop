import path from "node:path";
import { buildRepairPrompt, selectAgentFindings } from "../agents/prompt.js";
import { extractProviderOutputMetadata } from "../agents/provider-metadata.js";
import { formatProviderOutputLine } from "../agents/provider-output.js";
import { runProvider } from "../agents/provider-runner.js";
import type { ProviderStatus } from "../agents/providers.js";
import type { AgentSessionRecorder } from "../agents/session.js";
import {
	type AgentUsageTotals,
	type createChangedFileTracker,
	formatUsageTotals,
	mergeProviderUsage,
} from "../agents/session-activity.js";
import { diffNameOnly, readBinaryDiff } from "../agents/worktree.js";
import type { Diagnostic } from "../engines/types.js";
import type { AgentTui } from "../ui/agent-tui.js";
import { log } from "../ui/logger.js";
import { confirm, isCancel } from "../ui/prompts.js";
import { applyDiff, scanJson } from "./agent-local-cli.js";
import type { AgentOptions, AgentScanJson } from "./agent-types.js";

export const runProviderStep = async (input: {
	tui: AgentTui;
	session: AgentSessionRecorder;
	selected: ProviderStatus;
	worktreePath: string;
	findings: Diagnostic[];
	score: number | null;
	options: AgentOptions;
	usage: AgentUsageTotals;
	tracker: ReturnType<typeof createChangedFileTracker>;
}): Promise<void> => {
	if (input.findings.length === 0) {
		input.session.append("provider.skipped", {
			reason: "no_selected_findings",
			provider: input.selected.provider.id,
		});
		return;
	}
	input.tui.start(`Running ${input.selected.provider.label}`);
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
		score: input.score,
		targetScore: input.options.targetScore,
		findings: input.findings.length,
		maxTurns: input.options.maxTurns,
	});
	input.tui.setActiveLabel(`${input.selected.provider.label} is editing`);
	input.tracker.start();
	let exitCode: number | null = null;
	try {
		exitCode = await runProvider(input.selected.provider, {
			cwd: input.worktreePath,
			prompt,
			maxTurns: input.options.maxTurns,
			onEvent: (event) => {
				const displayLine = formatProviderOutputLine(event.line);
				if (displayLine) input.tui.appendLog(input.selected.provider.id, displayLine);
				const metadata = extractProviderOutputMetadata(event.line);
				if (metadata.usage) {
					Object.assign(input.usage, mergeProviderUsage(input.usage, metadata.usage));
					input.tui.setMetric("Tokens", formatUsageTotals(input.usage));
					input.session.append("provider.usage", {
						provider: input.selected.provider.id,
						usage: input.usage,
					});
				}
				for (const filePath of metadata.files) {
					input.tracker.noteFile(filePath, `${input.selected.provider.id} output`);
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
			message: error instanceof Error ? error.message : String(error),
		});
		input.tui.complete({
			status: "failed",
			label: `${input.selected.provider.label} failed`,
		});
		throw error;
	} finally {
		await input.tracker.stop();
	}
	input.session.append("provider.finished", {
		provider: input.selected.provider.id,
		exitCode,
	});
	input.tui.complete({
		status: exitCode === 0 ? "done" : "warn",
		label: `${input.selected.provider.label} exited ${exitCode ?? "unknown"}`,
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
): Promise<{ after: AgentScanJson; changedFiles: string[] }> => {
	tui.start("Verifying agent diff");
	const after = scanJson(cwd);
	const changedFiles = await diffNameOnly(cwd);
	tui.setMetric("Score", `${before.score ?? "not scored"} -> ${after.score ?? "not scored"}`);
	tui.setMetric("Changes", changedFiles.length);
	tui.setMetric("Remaining", after.diagnostics.length);
	tui.setActions(actionsForSession({ scan: after, changedFiles, options }));
	tui.complete({
		status: (after.score ?? 0) >= (before.score ?? 0) && changedFiles.length > 0 ? "done" : "warn",
		label: `Verified ${before.score ?? "not scored"} -> ${after.score ?? "not scored"} · ${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"} changed`,
	});
	return { after, changedFiles };
};

export const maybeContinueSession = async (input: {
	tui: AgentTui;
	session: AgentSessionRecorder;
	scan: AgentScanJson;
	options: AgentOptions;
}): Promise<boolean> => {
	if (!needsAnotherPass(input.scan)) return false;
	const findings = selectAgentFindings(input.scan.diagnostics, input.options.limit);
	if (findings.length === 0 || !process.stdin.isTTY) return false;
	input.session.append("continue.prompted", {
		score: input.scan.score,
		diagnostics: input.scan.diagnostics.length,
		targetScore: input.options.targetScore,
	});
	input.tui.pause();
	const shouldContinue = await confirm({
		message: `Score is ${input.scan.score ?? "not scored"} with ${findings.length} actionable finding${findings.length === 1 ? "" : "s"} remaining. Continue another agent pass?`,
		initialValue: false,
	});
	input.tui.resume();
	const accepted = !isCancel(shouldContinue) && Boolean(shouldContinue);
	input.session.append(accepted ? "continue.accepted" : "continue.skipped", {
		score: input.scan.score,
		diagnostics: input.scan.diagnostics.length,
		actionableFindings: findings.length,
	});
	return accepted;
};

export const maybeApplyDiff = async (input: {
	options: AgentOptions;
	changedFiles: string[];
	worktreePath: string;
	originalRoot: string;
	tui: AgentTui;
}): Promise<boolean> => {
	if (
		input.changedFiles.length === 0 ||
		input.worktreePath === input.originalRoot ||
		(!input.options.apply && !process.stdin.isTTY)
	) {
		return false;
	}
	input.tui.pause();
	const shouldApply =
		(input.options.apply && input.options.yes) ||
		(await confirm({
			message: `${input.options.apply ? "Apply" : "Apply now"} ${input.changedFiles.length} file change${input.changedFiles.length === 1 ? "" : "s"} back to ${path.basename(input.originalRoot)}?`,
			initialValue: false,
		}));
	input.tui.resume();
	if (isCancel(shouldApply)) {
		log.warn("Apply cancelled. Worktree left for review.");
		return false;
	}
	if (!shouldApply) return false;
	await applyDiff(input.originalRoot, await readBinaryDiff(input.worktreePath));
	return true;
};
