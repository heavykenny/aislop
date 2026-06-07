import fs from "node:fs";
import path from "node:path";

export interface AgentSessionEvent {
	type: string;
	timestamp: string;
	sessionId: string;
	[key: string]: unknown;
}

export interface AgentSessionSummary {
	id: string;
	path: string;
	startedAt: string | null;
	endedAt: string | null;
	status: "completed" | "failed" | "running" | "stopped" | "unknown";
	provider: string | null;
	providerLabel: string | null;
	mode: string | null;
	worktreePath: string | null;
	backgroundPid: number | null;
	logPath: string | null;
	scoreBefore: number | null;
	scoreAfter: number | null;
	changedFiles: number | null;
	totalTokens: number | null;
	costUsd: number | null;
	providerPasses: number | null;
	toolCalls: number | null;
	outputEvents: number | null;
	applied: boolean;
	published: boolean;
}

export const agentSessionDir = (root: string): string =>
	path.join(root, ".aislop", "agent", "sessions");

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asNumber = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const latestTimestamp = (events: AgentSessionEvent[]): string | null =>
	events.at(-1)?.timestamp ?? null;

export const readAgentSessionEvents = (sessionPath: string): AgentSessionEvent[] => {
	const raw = fs.readFileSync(sessionPath, "utf-8").trim();
	if (!raw) return [];
	const events: AgentSessionEvent[] = [];
	for (const line of raw.split("\n")) {
		try {
			events.push(JSON.parse(line) as AgentSessionEvent);
		} catch {
			break;
		}
	}
	return events;
};

export const isTerminalAgentSession = (events: AgentSessionEvent[]): boolean =>
	events.some(
		(event) =>
			event.type === "session.completed" ||
			event.type === "session.failed" ||
			event.type === "background.stopped",
	);

export const summarizeAgentSession = (
	sessionPath: string,
	events: AgentSessionEvent[],
): AgentSessionSummary => {
	const id = path.basename(sessionPath, ".jsonl");
	const started = events.find((event) => event.type === "session.started");
	const queued = events.find((event) => event.type === "session.queued");
	const kickoff = started ?? queued;
	const completed = events.find((event) => event.type === "session.completed");
	const failed = events.find((event) => event.type === "session.failed");
	const stopped = events.find((event) => event.type === "background.stopped");
	const backgroundStarted = [...events]
		.reverse()
		.find((event) => event.type === "background.started");
	const worktree = events.find((event) => event.type === "worktree.prepared");
	const baseline = events.find((event) => event.type === "scan.baseline");
	const applied = events.find((event) => event.type === "diff.applied");
	const verified = [...events].reverse().find((event) => event.type === "diff.verified");
	const verifiedScan = isObject(verified?.scan) ? verified.scan : null;
	const usage = [...events].reverse().find((event) => event.type === "provider.usage");
	const usagePayload = isObject(usage?.usage) ? usage.usage : null;
	const providerFinished = events.filter((event) => event.type === "provider.finished");
	const inferredPasses = Math.max(0, ...providerFinished.map((event) => asNumber(event.pass) ?? 0));
	const summedToolCalls = providerFinished.reduce(
		(sum, event) => sum + (asNumber(event.toolCalls) ?? 0),
		0,
	);
	const summedOutputEvents = providerFinished.reduce(
		(sum, event) => sum + (asNumber(event.outputEvents) ?? 0),
		0,
	);
	const status = failed
		? "failed"
		: stopped
			? "stopped"
			: completed
				? "completed"
				: events.length > 0
					? "running"
					: "unknown";
	return {
		id,
		path: sessionPath,
		startedAt: kickoff?.timestamp ?? events[0]?.timestamp ?? null,
		endedAt:
			completed?.timestamp ?? failed?.timestamp ?? stopped?.timestamp ?? latestTimestamp(events),
		status,
		provider: asString(started?.provider) ?? asString(queued?.providerSelection),
		providerLabel: asString(started?.providerLabel),
		mode: asString(kickoff?.mode),
		worktreePath: asString(worktree?.path),
		backgroundPid: asNumber(backgroundStarted?.pid),
		logPath: asString(backgroundStarted?.logPath) ?? asString(queued?.logPath),
		scoreBefore: asNumber(completed?.scoreBefore) ?? asNumber(baseline?.score),
		scoreAfter: asNumber(completed?.scoreAfter) ?? asNumber(verifiedScan?.score),
		changedFiles: asNumber(completed?.changedFiles),
		totalTokens: asNumber(completed?.totalTokens) ?? asNumber(usagePayload?.totalTokens),
		costUsd: asNumber(completed?.costUsd) ?? asNumber(usagePayload?.costUsd),
		providerPasses:
			asNumber(completed?.providerPasses) ?? (inferredPasses > 0 ? inferredPasses : null),
		toolCalls: asNumber(completed?.toolCalls) ?? (summedToolCalls > 0 ? summedToolCalls : null),
		outputEvents:
			asNumber(completed?.outputEvents) ?? (summedOutputEvents > 0 ? summedOutputEvents : null),
		applied: completed?.applied === true || Boolean(applied),
		published: completed?.published === true,
	};
};

const listAgentSessionFiles = (root: string): string[] => {
	const dir = agentSessionDir(root);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((file) => file.endsWith(".jsonl"))
		.map((file) => path.join(dir, file))
		.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
};

export const listAgentSessions = (
	root: string,
	options: { limit?: number } = {},
): AgentSessionSummary[] =>
	listAgentSessionFiles(root)
		.slice(0, options.limit ?? 10)
		.map((sessionPath) => summarizeAgentSession(sessionPath, readAgentSessionEvents(sessionPath)));

export const resolveAgentSessionPath = (root: string, session?: string): string | null => {
	const files = listAgentSessionFiles(root);
	if (!session) return files[0] ?? null;
	if (fs.existsSync(session)) return session;
	const direct = path.join(agentSessionDir(root), `${session}.jsonl`);
	if (fs.existsSync(direct)) return direct;
	const matches = files.filter((file) => path.basename(file, ".jsonl").startsWith(session));
	return matches.length === 1 ? matches[0] : null;
};
