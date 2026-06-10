import fs from "node:fs";
import path from "node:path";

export interface AgentMonitorCycle {
	timestamp: string;
	reason: string;
	score: number | null;
	diagnostics: number;
	findings: number;
	changedFiles: string[];
	repaired: boolean;
	targetMet: boolean;
}

export interface AgentMonitorRecord {
	id: string;
	root: string;
	requestedDirectory: string;
	startedAt: string;
	stoppedAt?: string;
	pid?: number;
	provider: string;
	providerSource: string;
	providerPreference?: string;
	repair: boolean;
	inPlace: boolean;
	interval: number;
	debounce: number;
	targetScore: number;
	maxTurns: number;
	limit: number;
	noFix: boolean;
	logPath: string;
	signal?: string;
	recentCycles?: AgentMonitorCycle[];
}

export interface AgentMonitorSummary extends AgentMonitorRecord {
	path: string;
	status: "running" | "stopped" | "exited";
}

const pad = (value: number): string => String(value).padStart(2, "0");

export const buildAgentMonitorId = (date = new Date(), pid = process.pid): string =>
	[
		"monitor",
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
		`${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
		String(pid),
	].join("-");

const agentMonitorDir = (root: string): string => path.join(root, ".aislop", "agent", "monitors");

export const agentMonitorPath = (root: string, id: string): string =>
	path.join(agentMonitorDir(root), `${id}.json`);

export const writeAgentMonitorRecord = (root: string, record: AgentMonitorRecord): void => {
	const file = agentMonitorPath(root, record.id);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
};

export const updateAgentMonitorRecord = (
	root: string,
	id: string,
	update: (record: AgentMonitorRecord) => AgentMonitorRecord,
): AgentMonitorRecord | null => {
	const file = agentMonitorPath(root, id);
	const record = readAgentMonitorRecord(file);
	if (!record) return null;
	const updated = update(record);
	writeAgentMonitorRecord(root, updated);
	return updated;
};

export const readAgentMonitorRecord = (file: string): AgentMonitorRecord | null => {
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<AgentMonitorRecord>;
		if (!parsed.id || !parsed.root || !parsed.startedAt || !parsed.logPath) return null;
		return parsed as AgentMonitorRecord;
	} catch {
		return null;
	}
};

export const isProcessRunning = (pid?: number): boolean => {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

export const summarizeAgentMonitor = (
	file: string,
	record: AgentMonitorRecord,
): AgentMonitorSummary => ({
	...record,
	path: file,
	status: record.stoppedAt ? "stopped" : isProcessRunning(record.pid) ? "running" : "exited",
});

export const appendAgentMonitorCycle = (
	root: string,
	id: string,
	cycle: AgentMonitorCycle,
	limit = 8,
): AgentMonitorRecord | null =>
	updateAgentMonitorRecord(root, id, (record) => ({
		...record,
		recentCycles: [...(record.recentCycles ?? []), cycle].slice(-Math.max(1, limit)),
	}));

const monitorFiles = (root: string): string[] => {
	const dir = agentMonitorDir(root);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((file) => file.endsWith(".json"))
		.map((file) => path.join(dir, file));
};

export const listAgentMonitors = (
	root: string,
	options: { limit?: number } = {},
): AgentMonitorSummary[] =>
	monitorFiles(root)
		.map((file) => {
			const record = readAgentMonitorRecord(file);
			return record ? summarizeAgentMonitor(file, record) : null;
		})
		.filter((summary): summary is AgentMonitorSummary => summary !== null)
		.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
		.slice(0, options.limit ?? 10);

export const resolveAgentMonitorPath = (root: string, monitor?: string): string | null => {
	const files = monitorFiles(root).sort((a, b) => b.localeCompare(a));
	if (!monitor) return files[0] ?? null;
	if (fs.existsSync(monitor)) return monitor;
	const direct = agentMonitorPath(root, monitor);
	if (fs.existsSync(direct)) return direct;
	const matches = files.filter((file) => path.basename(file, ".json").startsWith(monitor));
	return matches.length === 1 ? matches[0] : null;
};
