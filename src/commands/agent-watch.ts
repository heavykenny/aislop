import { formatProviderOutputLine } from "../agents/provider-output.js";
import { formatToolCalls } from "../agents/session-activity.js";
import {
	type AgentSessionEvent,
	isTerminalAgentSession,
	readAgentSessionEvents,
	resolveAgentSessionPath,
	summarizeAgentSession,
} from "../agents/session-store.js";
import { renderDisplayRows, renderDisplaySection } from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { log } from "../ui/logger.js";
import { style, theme } from "../ui/theme.js";
import { APP_VERSION } from "../version.js";
import { displayAgentPath } from "./agent-display-path.js";
import { renderAgentSessionReview } from "./agent-session-review.js";
import { resolveAgentGitRoot } from "./agent-session-root.js";

interface AgentWatchOptions {
	root: string;
	interval: number;
	once: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const compactLine = (line: string): string =>
	line.length > 180 ? `${line.slice(0, 177)}...` : line;

export const renderAgentWatchEvent = (event: AgentSessionEvent): string | null => {
	if (event.type === "provider.output" && typeof event.line === "string") {
		const line =
			typeof event.displayLine === "string"
				? event.displayLine
				: formatProviderOutputLine(event.line);
		if (!line) return null;
		return `${style(theme, "muted", String(event.provider ?? "provider").padEnd(8))} ${style(theme, "dim", compactLine(line))}`;
	}
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
		return `baseline score ${event.score ?? "n/a"} with ${event.diagnostics ?? "n/a"} findings`;
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
		return `pass ${event.pass ?? "?"} diff verified with ${files} changed file${files === 1 ? "" : "s"}`;
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

export const renderAgentWatchSnapshot = (input: {
	root: string;
	sessionPath: string;
	events: AgentSessionEvent[];
	fromIndex?: number;
}): string => {
	const summary = summarizeAgentSession(input.sessionPath, input.events);
	const lines = [
		renderHeader({
			version: APP_VERSION,
			command: "Agent watch",
			context: [summary.id],
		}).trimEnd(),
		"",
		renderDisplaySection("Details"),
		...renderDisplayRows(
			[
				{ label: "Status", value: summary.status },
				{
					label: "Provider",
					value: summary.providerLabel ?? summary.provider ?? "unknown provider",
				},
				{ label: "Transcript", value: displayAgentPath(input.root, input.sessionPath) },
			],
			{ indent: 3, labelWidth: 10 },
		),
		"",
	];
	for (const event of input.events.slice(input.fromIndex ?? 0)) {
		const line = renderAgentWatchEvent(event);
		if (line) lines.push(` ${style(theme, "muted", event.timestamp)}  ${line}`);
	}
	if ((input.fromIndex ?? 0) === 0 && isTerminalAgentSession(input.events)) {
		lines.push("", ...renderAgentSessionReview({ summary, events: input.events }));
	}
	return `${lines.join("\n")}\n`;
};

export const agentWatchCommand = async (
	session: string | undefined,
	options: AgentWatchOptions,
): Promise<void> => {
	try {
		const root = await resolveAgentGitRoot(options.root);
		const sessionPath = resolveAgentSessionPath(root, session);
		if (!sessionPath) {
			throw new Error(
				session ? `No matching agent session: ${session}` : "No agent sessions found.",
			);
		}
		let emitted = 0;
		let printedHeader = false;
		let printedReview = false;
		while (true) {
			const events = readAgentSessionEvents(sessionPath);
			if (!printedHeader) {
				process.stdout.write(renderAgentWatchSnapshot({ root, sessionPath, events }));
				printedHeader = true;
				emitted = events.length;
				printedReview = isTerminalAgentSession(events);
			} else if (events.length > emitted) {
				for (const event of events.slice(emitted)) {
					const line = renderAgentWatchEvent(event);
					if (line) process.stdout.write(` ${style(theme, "muted", event.timestamp)}  ${line}\n`);
				}
				emitted = events.length;
			}
			if (options.once || isTerminalAgentSession(events)) {
				if (!printedReview && emitted > 0 && isTerminalAgentSession(events)) {
					process.stdout.write(
						`\n${renderAgentSessionReview({
							summary: summarizeAgentSession(sessionPath, events),
							events,
						}).join("\n")}\n`,
					);
				}
				return;
			}
			await sleep(Math.max(250, options.interval));
		}
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
};
