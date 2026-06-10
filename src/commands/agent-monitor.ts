import path from "node:path";
import { performance } from "node:perf_hooks";
import { appendAgentMonitorCycle } from "../agents/monitor-store.js";
import { selectAgentFindings } from "../agents/prompt.js";
import { resolveAgentProviderSelection } from "../agents/provider-preference.js";
import { getProviderStatuses, type ProviderStatus, resolveProvider } from "../agents/providers.js";
import { prepareAgentLocalState } from "../agents/worktree.js";
import { renderDisplayRows, renderDisplaySection } from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { LiveRail } from "../ui/live-rail.js";
import { log } from "../ui/logger.js";
import { runSubprocess } from "../utils/subprocess.js";
import { APP_VERSION } from "../version.js";
import { scanJson } from "./agent-local-cli.js";
import {
	launchMonitorInBackground,
	renderMonitorBackgroundLaunch,
} from "./agent-monitor-background.js";
import type { AgentMonitorOptions } from "./agent-monitor-types.js";
import { runAgentSession } from "./agent-session.js";
import type { AgentOptions, AgentScanJson } from "./agent-types.js";

export interface GitChangeSnapshot {
	signature: string;
	files: string[];
}

interface MonitorDebounceState {
	current: GitChangeSnapshot;
	pending: GitChangeSnapshot | null;
	changedAt: number;
}

interface MonitorDebounceUpdate extends MonitorDebounceState {
	detected: boolean;
	settled: GitChangeSnapshot | null;
}

interface MonitorCycleResult {
	scan: AgentScanJson;
	findings: number;
	changedFiles: string[];
	repaired: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const parseGitStatusPaths = (stdout: string): string[] =>
	stdout
		.split("\n")
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.map((line) => {
			const match = line.match(/^[ MADRCU?!]{1,2}\s+(.+)$/);
			return (match?.[1] ?? line.slice(3)).replace(/^.* -> /, "").trim();
		})
		.filter(Boolean);

const readGitChangeSnapshot = async (root: string): Promise<GitChangeSnapshot> => {
	const result = await runSubprocess(
		"git",
		["status", "--porcelain=v1", "--untracked-files=normal"],
		{ cwd: root },
	);
	if (result.exitCode !== 0) {
		throw new Error(result.stderr || result.stdout || "Failed to read git status.");
	}
	return {
		signature: result.stdout,
		files: parseGitStatusPaths(result.stdout),
	};
};

const providerSourceText = (options: AgentOptions): string => {
	if (options.providerSource === "cli") return "--provider flag";
	if (options.providerSource === "preference") {
		return `saved local default (${options.providerPreference ?? options.provider})`;
	}
	return "auto-detect installed provider";
};

const providerLabel = (provider: ProviderStatus | null): string =>
	provider
		? `${provider.provider.label}${provider.version ? ` (${provider.version})` : ""}`
		: "none selected";

export const shouldMonitorRepair = (input: {
	repair: boolean;
	inPlace: boolean;
	score: number | null;
	targetScore: number;
	findings: number;
}): boolean =>
	input.repair &&
	input.inPlace &&
	input.findings > 0 &&
	(input.score === null || input.score < input.targetScore);

export const updateMonitorDebounceState = (input: {
	current: GitChangeSnapshot;
	pending: GitChangeSnapshot | null;
	changedAt: number;
	next: GitChangeSnapshot;
	now: number;
	debounce: number;
}): MonitorDebounceUpdate => {
	if (input.next.signature === input.current.signature) {
		return {
			current: input.current,
			pending: null,
			changedAt: 0,
			detected: false,
			settled: null,
		};
	}
	if (input.pending?.signature !== input.next.signature) {
		if (input.debounce <= 0) {
			return {
				current: input.next,
				pending: null,
				changedAt: 0,
				detected: true,
				settled: input.next,
			};
		}
		return {
			current: input.current,
			pending: input.next,
			changedAt: input.now,
			detected: true,
			settled: null,
		};
	}
	if (input.now - input.changedAt >= input.debounce) {
		return {
			current: input.pending,
			pending: null,
			changedAt: 0,
			detected: false,
			settled: input.pending,
		};
	}
	return {
		current: input.current,
		pending: input.pending,
		changedAt: input.changedAt,
		detected: false,
		settled: null,
	};
};

const changedFilesText = (files: string[]): string => {
	if (files.length === 0) return "no git changes";
	const preview = files.slice(0, 4).join(", ");
	return files.length > 4 ? `${preview}, +${files.length - 4} more` : preview;
};

const recordMonitorCycle = (input: {
	root: string;
	reason: string;
	scan: AgentScanJson;
	findings: number;
	changedFiles: string[];
	repaired: boolean;
	targetScore: number;
}): void => {
	const monitorId = process.env.AISLOP_AGENT_MONITOR_ID;
	if (!monitorId) return;
	appendAgentMonitorCycle(input.root, monitorId, {
		timestamp: new Date().toISOString(),
		reason: input.reason,
		score: input.scan.score,
		diagnostics: input.scan.diagnostics.length,
		findings: input.findings,
		changedFiles: input.changedFiles.slice(0, 12),
		repaired: input.repaired,
		targetMet: input.scan.score !== null && input.scan.score >= input.targetScore,
	});
};

const renderMonitorIntro = (input: {
	root: string;
	provider: ProviderStatus | null;
	options: AgentMonitorOptions;
}): void => {
	process.stdout.write(
		renderHeader({
			version: APP_VERSION,
			command: "Agent monitor",
			context: [input.options.repair ? "repair" : "watch"],
		}),
	);
	process.stdout.write(
		`${[
			renderDisplaySection("Settings"),
			...renderDisplayRows(
				[
					{ label: "Root", value: input.root },
					{ label: "Provider", value: providerLabel(input.provider) },
					{ label: "Source", value: providerSourceText(input.options) },
					{
						label: "Mode",
						value: input.options.repair ? "repair on failing scans" : "scan and report",
					},
					{ label: "Edit target", value: input.options.inPlace ? "current worktree" : "none" },
					{ label: "Interval", value: `${input.options.interval}ms` },
					{ label: "Debounce", value: `${input.options.debounce}ms` },
				],
				{ indent: 3, labelWidth: 11 },
			),
			"",
		].join("\n")}`,
	);
	if (!input.options.repair) {
		log.muted("Repair is off. Add `--repair --in-place` to run bounded local repairs.");
	} else if (!input.options.inPlace) {
		log.warn("Repair mode needs `--in-place` before it can edit the watched checkout.");
	}
};

const resolveMonitorProvider = (root: string, options: AgentMonitorOptions) => {
	const providerChoice = resolveAgentProviderSelection({
		root,
		requested: options.provider,
		explicit: options.providerSource === "cli",
	});
	const resolvedOptions: AgentMonitorOptions = {
		...options,
		provider: providerChoice.selection,
		providerSource: providerChoice.source,
		providerPreference: providerChoice.preference?.provider,
	};
	return {
		options: resolvedOptions,
		provider: resolveProvider(resolvedOptions.provider, getProviderStatuses()),
	};
};

const assertCanRepair = (provider: ProviderStatus | null, options: AgentMonitorOptions): void => {
	if (!options.repair) return;
	if (!options.inPlace) {
		throw new Error(
			"Monitor repair edits the watched checkout. Re-run with `--repair --in-place`.",
		);
	}
	if (!provider || !provider.installed) {
		throw new Error("Monitor repair needs an installed provider. Run `aislop agent providers`.");
	}
	if (provider.authenticated === false) {
		throw new Error(`${provider.provider.label} is installed but not authenticated.`);
	}
};

const runMonitorCycle = async (input: {
	root: string;
	directory: string;
	snapshot: GitChangeSnapshot;
	provider: ProviderStatus | null;
	options: AgentMonitorOptions;
	reason: string;
}): Promise<MonitorCycleResult> => {
	const rail = new LiveRail();
	rail.start(`Scanning ${input.reason}`);
	const scan = scanJson(input.directory);
	const findings = selectAgentFindings(scan.diagnostics, input.options.limit);
	rail.complete({
		status: scan.summary.errors > 0 ? "warn" : "done",
		label: `Score ${scan.score ?? "not scored"} / 100 · ${scan.diagnostics.length} findings · ${changedFilesText(input.snapshot.files)}`,
	});
	const shouldRepair = shouldMonitorRepair({
		repair: input.options.repair,
		inPlace: input.options.inPlace,
		score: scan.score,
		targetScore: input.options.targetScore,
		findings: findings.length,
	});
	if (!shouldRepair) {
		rail.finish({
			footer:
				findings.length === 0 || (scan.score ?? 0) >= input.options.targetScore
					? "Monitor idle · target met"
					: "Monitor idle · repair disabled",
		});
		recordMonitorCycle({
			root: input.root,
			reason: input.reason,
			scan,
			findings: findings.length,
			changedFiles: input.snapshot.files,
			repaired: false,
			targetScore: input.options.targetScore,
		});
		return {
			scan,
			findings: findings.length,
			changedFiles: input.snapshot.files,
			repaired: false,
		};
	}
	rail.finish({ footer: "Monitor triggering repair session" });
	await runAgentSession(
		input.provider as ProviderStatus,
		input.directory,
		input.options,
		performance.now(),
	);
	recordMonitorCycle({
		root: input.root,
		reason: input.reason,
		scan,
		findings: findings.length,
		changedFiles: input.snapshot.files,
		repaired: true,
		targetScore: input.options.targetScore,
	});
	return {
		scan,
		findings: findings.length,
		changedFiles: input.snapshot.files,
		repaired: true,
	};
};

const monitorOnce = async (input: {
	root: string;
	directory: string;
	provider: ProviderStatus | null;
	options: AgentMonitorOptions;
}): Promise<MonitorCycleResult> => {
	const snapshot = await readGitChangeSnapshot(input.root);
	return await runMonitorCycle({
		...input,
		snapshot,
		reason: snapshot.files.length > 0 ? "current changes" : "current checkout",
	});
};

const monitorLoop = async (input: {
	root: string;
	directory: string;
	provider: ProviderStatus | null;
	options: AgentMonitorOptions;
}): Promise<void> => {
	let current = await readGitChangeSnapshot(input.root);
	await runMonitorCycle({
		...input,
		snapshot: current,
		reason: current.files.length > 0 ? "current changes" : "current checkout",
	});
	let pending: GitChangeSnapshot | null = null;
	let changedAt = 0;
	for (;;) {
		const next = await readGitChangeSnapshot(input.root);
		const update = updateMonitorDebounceState({
			current,
			pending,
			changedAt,
			next,
			now: Date.now(),
			debounce: input.options.debounce,
		});
		current = update.current;
		pending = update.pending;
		changedAt = update.changedAt;
		if (update.detected) {
			log.info(`Change detected: ${changedFilesText(next.files)}`);
		}
		if (update.settled) {
			await runMonitorCycle({
				...input,
				snapshot: update.settled,
				reason: "settled changes",
			});
		}
		await sleep(Math.max(500, input.options.interval));
	}
};

export const agentMonitorCommand = async (
	directory: string,
	options: AgentMonitorOptions,
): Promise<void> => {
	try {
		const requestedDirectory = path.resolve(directory);
		const { root } = await prepareAgentLocalState(requestedDirectory);
		const resolved = resolveMonitorProvider(root, options);
		renderMonitorIntro({ root, provider: resolved.provider, options: resolved.options });
		if (resolved.options.dryRun) return;
		assertCanRepair(resolved.provider, resolved.options);
		if (resolved.options.background) {
			return renderMonitorBackgroundLaunch(
				await launchMonitorInBackground(requestedDirectory, resolved.options),
			);
		}
		if (resolved.options.once) {
			await monitorOnce({
				root,
				directory: requestedDirectory,
				provider: resolved.provider,
				options: resolved.options,
			});
			return;
		}
		await monitorLoop({
			root,
			directory: requestedDirectory,
			provider: resolved.provider,
			options: resolved.options,
		});
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
};
