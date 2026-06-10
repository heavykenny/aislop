import path from "node:path";
import { formatProviderOutputLine } from "../agents/provider-output.js";
import { formatDiffStat, formatToolCalls } from "../agents/session-activity.js";
import {
	type AgentSessionEvent,
	type AgentSessionSummary,
	listAgentSessions,
	readAgentSessionEvents,
	resolveAgentSessionPath,
	summarizeAgentSession,
} from "../agents/session-store.js";
import {
	type DisplayStatusItem,
	renderDisplayCommandRows,
	renderDisplayRows,
	renderDisplaySection,
	renderDisplayStatusItems,
} from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { log } from "../ui/logger.js";
import { style, theme } from "../ui/theme.js";
import { APP_VERSION } from "../version.js";
import { displayAgentPath } from "./agent-display-path.js";
import { renderAgentSessionReview } from "./agent-session-review.js";
import { resolveAgentGitRoot } from "./agent-session-root.js";

interface AgentSessionsOptions {
	limit: number;
}

interface AgentShowOptions {
	root: string;
}

const statusMarker = (status: AgentSessionSummary["status"]): string => {
	if (status === "completed") return style(theme, "success", "✓");
	if (status === "failed") return style(theme, "danger", "x");
	if (status === "stopped") return style(theme, "warn", "!");
	if (status === "running") return style(theme, "info", "*");
	return style(theme, "muted", ".");
};

const scoreText = (summary: AgentSessionSummary): string => {
	if (summary.scoreBefore === null && summary.scoreAfter === null) return "score n/a";
	return `${summary.scoreBefore ?? "n/a"} -> ${summary.scoreAfter ?? "n/a"}`;
};

const changedText = (summary: AgentSessionSummary): string => {
	const count = summary.changedFiles ?? 0;
	return `${count} file${count === 1 ? "" : "s"}`;
};

const usageText = (summary: AgentSessionSummary): string => {
	if (summary.totalTokens === null && summary.costUsd === null) return "tokens n/a";
	const parts: string[] = [];
	if (summary.totalTokens !== null) parts.push(`${summary.totalTokens.toLocaleString()} tokens`);
	if (summary.costUsd !== null) parts.push(`$${summary.costUsd.toFixed(4)}`);
	return parts.join(" / ");
};

const providerText = (summary: AgentSessionSummary): string =>
	summary.providerLabel ?? summary.provider ?? "unknown provider";

const passText = (summary: AgentSessionSummary): string =>
	summary.providerPasses === null ? "passes n/a" : String(summary.providerPasses);

const toolText = (summary: AgentSessionSummary): string =>
	summary.toolCalls === null ? "tools n/a" : formatToolCalls(summary.toolCalls);

const sessionStatusItem = (root: string, session: AgentSessionSummary): DisplayStatusItem => ({
	marker: statusMarker(session.status),
	label: session.id,
	rows: [
		{ label: "Status", value: session.status },
		{ label: "Provider", value: providerText(session) },
		{ label: "Score", value: scoreText(session) },
		{ label: "Changed", value: changedText(session) },
		{ label: "Usage", value: usageText(session) },
		{ label: "Passes", value: passText(session) },
		{ label: "Tools", value: toolText(session) },
		{ label: "Started", value: session.startedAt ?? "unknown time" },
		{ label: "Record", value: path.relative(root, session.path) },
	],
});

export const renderAgentSessionList = (input: {
	root: string;
	sessions: AgentSessionSummary[];
}): string => {
	const lines = [
		renderHeader({
			version: APP_VERSION,
			command: "Agent sessions",
			context: [path.basename(input.root)],
		}).trimEnd(),
		"",
		renderDisplaySection("Sessions"),
	];
	if (input.sessions.length === 0) {
		lines.push(" No local agent sessions yet.");
		lines.push(
			"",
			renderDisplaySection("Next"),
			...renderDisplayCommandRows([{ label: "Create", command: "aislop agent" }]),
		);
		return `${lines.join("\n")}\n`;
	}
	lines.push(
		...renderDisplayStatusItems(
			input.sessions.map((session) => sessionStatusItem(input.root, session)),
			{ labelWidth: 8 },
		),
	);
	lines.push(
		"",
		renderDisplaySection("Next"),
		...renderDisplayCommandRows([{ label: "Details", command: "aislop agent show <session>" }], {
			indent: 3,
		}),
	);
	return `${lines.join("\n")}\n`;
};

const eventLine = (event: AgentSessionEvent): string | null => {
	if (event.type === "session.queued") {
		return `queued background run with ${event.providerSelection ?? "auto"} provider`;
	}
	if (event.type === "background.started") {
		return `background process started${event.pid ? ` pid ${event.pid}` : ""}`;
	}
	if (event.type === "background.stopped") {
		return `background process stopped${event.signal ? ` with ${event.signal}` : ""}`;
	}
	if (event.type === "session.started") {
		return `started ${event.providerLabel ?? event.provider ?? "provider"} in ${event.mode ?? "session"} mode`;
	}
	if (event.type === "worktree.prepared") {
		return `worktree ${event.created ? "created" : "selected"} ${event.path ?? ""}`.trim();
	}
	if (event.type === "scan.baseline") {
		return `baseline scan score ${event.score ?? "n/a"} with ${event.diagnostics ?? "n/a"} findings`;
	}
	if (event.type === "fix.safe.finished") return "safe fixes finished";
	if (event.type === "fix.safe.skipped") return "safe fixes skipped";
	if (event.type === "findings.selected")
		return `pass ${event.pass ?? "?"} selected ${event.count ?? 0} findings`;
	if (event.type === "provider.started")
		return `pass ${event.pass ?? "?"} provider started with ${event.findings ?? 0} findings`;
	if (event.type === "provider.skipped")
		return `provider skipped${event.reason ? `: ${event.reason}` : ""}`;
	if (event.type === "provider.finished") {
		const exitCode =
			event.exitCode === 0 ? "finished" : `finished with exit ${event.exitCode ?? "unknown"}`;
		const tools =
			typeof event.toolCalls === "number" ? ` · ${formatToolCalls(event.toolCalls)}` : "";
		return `pass ${event.pass ?? "?"} provider ${exitCode}${tools}`;
	}
	if (event.type === "diff.verified") {
		const files = Array.isArray(event.changedFiles) ? event.changedFiles.length : 0;
		const score =
			typeof event.scoreBefore === "number" && typeof event.scan === "object" && event.scan !== null
				? ` · ${event.scoreBefore} -> ${(event.scan as { score?: unknown }).score ?? "n/a"}`
				: "";
		return `pass ${event.pass ?? "?"} diff verified${score} · ${files} changed file${files === 1 ? "" : "s"}`;
	}
	if (event.type === "diff.applied") return "diff applied to original worktree";
	if (event.type === "diff.apply_skipped") return "diff apply skipped";
	if (event.type === "publish.started")
		return event.pr ? "publish started for PR" : "publish started";
	if (event.type === "publish.finished") return "publish finished";
	if (event.type === "publish.skipped")
		return `publish skipped${event.reason ? `: ${event.reason}` : ""}`;
	if (event.type === "session.completed") return "session completed";
	if (event.type === "session.failed") return `session failed: ${event.message ?? "unknown error"}`;
	if (event.type === "worktree.removed") return "worktree removed";
	return null;
};

const changedFilesFrom = (events: AgentSessionEvent[]): string[] => {
	const event = [...events].reverse().find((item) => item.type === "diff.verified");
	return Array.isArray(event?.changedFiles)
		? event.changedFiles.filter((file) => typeof file === "string")
		: [];
};

const editedFilesFrom = (events: AgentSessionEvent[]): string[] => {
	const latestByFile = new Map<string, AgentSessionEvent>();
	for (const event of events) {
		if (event.type !== "file.changed" || typeof event.filePath !== "string") continue;
		latestByFile.set(event.filePath, event);
	}
	return [...latestByFile.values()].map((event) => {
		return `${event.filePath} · ${formatDiffStat({
			additions: typeof event.additions === "number" ? event.additions : null,
			deletions: typeof event.deletions === "number" ? event.deletions : null,
			binary: event.binary === true,
		})}`;
	});
};

const selectedFindingsFrom = (events: AgentSessionEvent[]): string[] => {
	const event = events.find((item) => item.type === "findings.selected");
	if (!Array.isArray(event?.findings)) return [];
	return event.findings
		.filter(
			(finding): finding is Record<string, unknown> =>
				typeof finding === "object" && finding !== null,
		)
		.map((finding) =>
			`${finding.filePath ?? "unknown"}:${finding.line ?? 0} ${finding.rule ?? ""}`.trim(),
		);
};

const providerOutputFrom = (events: AgentSessionEvent[]): string[] =>
	events
		.filter((event) => event.type === "provider.output" && typeof event.line === "string")
		.map((event) =>
			typeof event.displayLine === "string"
				? event.displayLine
				: (formatProviderOutputLine(String(event.line)) ?? ""),
		)
		.filter(Boolean);

export const renderAgentSessionShow = (input: {
	root: string;
	summary: AgentSessionSummary;
	events: AgentSessionEvent[];
}): string => {
	const lines = [
		renderHeader({
			version: APP_VERSION,
			command: "Agent session",
			context: [input.summary.id],
		}).trimEnd(),
		"",
		renderDisplaySection("Details"),
		...renderDisplayRows(
			[
				{ label: "Status", value: input.summary.status },
				{ label: "Provider", value: providerText(input.summary) },
				{ label: "Score", value: scoreText(input.summary) },
				{ label: "Changed", value: changedText(input.summary) },
				{ label: "Usage", value: usageText(input.summary) },
				{ label: "Passes", value: passText(input.summary) },
				{ label: "Tools", value: toolText(input.summary) },
				{ label: "Started", value: input.summary.startedAt ?? "unknown" },
				{ label: "Transcript", value: displayAgentPath(input.root, input.summary.path) },
				...(input.summary.worktreePath
					? [{ label: "Worktree", value: displayAgentPath(input.root, input.summary.worktreePath) }]
					: []),
				...(input.summary.backgroundPid
					? [{ label: "PID", value: String(input.summary.backgroundPid) }]
					: []),
				...(input.summary.logPath ? [{ label: "Log", value: input.summary.logPath }] : []),
			],
			{ indent: 3, labelWidth: 10 },
		),
	];

	lines.push("", ...renderAgentSessionReview({ summary: input.summary, events: input.events }));

	lines.push("", renderDisplaySection("Timeline"));
	for (const event of input.events) {
		const line = eventLine(event);
		if (line) lines.push(` - ${event.timestamp}: ${line}`);
	}

	const findings = selectedFindingsFrom(input.events);
	if (findings.length > 0) {
		lines.push("", renderDisplaySection("Selected findings"));
		for (const finding of findings.slice(0, 8)) lines.push(` - ${finding}`);
		if (findings.length > 8) lines.push(` - ...and ${findings.length - 8} more`);
	}

	const changedFiles = changedFilesFrom(input.events);
	if (changedFiles.length > 0) {
		lines.push("", renderDisplaySection("Changed files"));
		for (const file of changedFiles.slice(0, 12)) lines.push(` - ${file}`);
		if (changedFiles.length > 12) lines.push(` - ...and ${changedFiles.length - 12} more`);
	}

	const editedFiles = editedFilesFrom(input.events);
	if (editedFiles.length > 0) {
		lines.push("", renderDisplaySection("File activity"));
		for (const file of editedFiles.slice(0, 12)) lines.push(` - ${file}`);
		if (editedFiles.length > 12) lines.push(` - ...and ${editedFiles.length - 12} more`);
	}

	const output = providerOutputFrom(input.events);
	if (output.length > 0) {
		lines.push("", renderDisplaySection("Provider output"));
		for (const line of output.slice(-8))
			lines.push(`   ${line.length > 180 ? `${line.slice(0, 177)}...` : line}`);
	}
	return `${lines.join("\n")}\n`;
};

export const agentSessionsCommand = async (
	directory: string,
	options: AgentSessionsOptions,
): Promise<void> => {
	try {
		const root = await resolveAgentGitRoot(directory);
		process.stdout.write(
			renderAgentSessionList({ root, sessions: listAgentSessions(root, options) }),
		);
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
};

export const agentShowCommand = async (
	session: string | undefined,
	options: AgentShowOptions,
): Promise<void> => {
	try {
		const root = await resolveAgentGitRoot(options.root);
		const sessionPath = resolveAgentSessionPath(root, session);
		if (!sessionPath) {
			throw new Error(
				session ? `No matching agent session: ${session}` : "No agent sessions found.",
			);
		}
		const events = readAgentSessionEvents(sessionPath);
		process.stdout.write(
			renderAgentSessionShow({
				root,
				events,
				summary: summarizeAgentSession(sessionPath, events),
			}),
		);
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
};
