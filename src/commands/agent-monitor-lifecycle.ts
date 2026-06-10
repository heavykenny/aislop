import {
	type AgentMonitorRecord,
	type AgentMonitorSummary,
	isProcessRunning,
	listAgentMonitors,
	readAgentMonitorRecord,
	resolveAgentMonitorPath,
	summarizeAgentMonitor,
	writeAgentMonitorRecord,
} from "../agents/monitor-store.js";
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
import { resolveAgentGitRoot } from "./agent-session-root.js";

interface MonitorListOptions {
	limit: number;
}

interface MonitorRootOptions {
	root: string;
}

interface MonitorStopOptions extends MonitorRootOptions {
	force: boolean;
}

const statusMarker = (status: AgentMonitorSummary["status"]): string => {
	if (status === "running") return style(theme, "info", "*");
	if (status === "stopped") return style(theme, "warn", "!");
	return style(theme, "muted", ".");
};

const modeText = (monitor: AgentMonitorRecord): string => (monitor.repair ? "repair" : "watch");

const latestCycle = (monitor: AgentMonitorRecord) => monitor.recentCycles?.at(-1);

const cycleSummaryText = (monitor: AgentMonitorRecord): string => {
	const cycle = latestCycle(monitor);
	if (!cycle) return "no cycles yet";
	const score = cycle.score === null ? "not scored" : `${cycle.score}/100`;
	return `${score}, ${cycle.diagnostics} finding${cycle.diagnostics === 1 ? "" : "s"}`;
};

const monitorStatusItem = (monitor: AgentMonitorSummary): DisplayStatusItem => ({
	marker: statusMarker(monitor.status),
	label: monitor.id,
	rows: [
		{ label: "Status", value: monitor.status },
		{ label: "Mode", value: modeText(monitor) },
		{ label: "Provider", value: monitor.provider },
		{ label: "Started", value: monitor.startedAt },
		{ label: "PID", value: String(monitor.pid ?? "n/a") },
		{ label: "Interval", value: `${monitor.interval}ms` },
		{ label: "Latest", value: cycleSummaryText(monitor) },
	],
});

const changedFilesText = (files: string[]): string => {
	if (files.length === 0) return "no git changes";
	const preview = files.slice(0, 4).join(", ");
	return files.length > 4 ? `${preview}, +${files.length - 4} more` : preview;
};

export const renderAgentMonitorList = (input: {
	root: string;
	monitors: AgentMonitorSummary[];
}): string => {
	const lines = [
		renderHeader({
			version: APP_VERSION,
			command: "Agent monitors",
			context: ["local"],
		}).trimEnd(),
		"",
		renderDisplaySection("Monitors"),
	];
	if (input.monitors.length === 0) {
		lines.push(" No local agent monitors yet.");
		lines.push(
			"",
			renderDisplaySection("Next"),
			...renderDisplayCommandRows([
				{ label: "Start", command: "aislop agent monitor --background" },
			]),
		);
		return `${lines.join("\n")}\n`;
	}
	lines.push(...renderDisplayStatusItems(input.monitors.map(monitorStatusItem), { labelWidth: 8 }));
	lines.push(
		"",
		renderDisplaySection("Next"),
		...renderDisplayCommandRows([
			{ label: "Details", command: "aislop agent monitor show <monitor>" },
		]),
	);
	return `${lines.join("\n")}\n`;
};

export const renderAgentMonitorShow = (monitor: AgentMonitorSummary): string => {
	const lines = [
		renderHeader({
			version: APP_VERSION,
			command: "Agent monitor",
			context: [monitor.id],
		}).trimEnd(),
		"",
		renderDisplaySection("Details"),
		...renderDisplayRows(
			[
				{ label: "Status", value: monitor.status },
				{ label: "Mode", value: modeText(monitor) },
				{ label: "Provider", value: monitor.provider },
				{ label: "Source", value: monitor.providerSource },
				{ label: "Root", value: monitor.root },
				{ label: "Directory", value: monitor.requestedDirectory },
				{ label: "Started", value: monitor.startedAt },
				{ label: "PID", value: String(monitor.pid ?? "n/a") },
				{ label: "Interval", value: `${monitor.interval}ms` },
				{ label: "Debounce", value: `${monitor.debounce}ms` },
				{ label: "Target", value: `${monitor.targetScore} / 100` },
				{ label: "Limit", value: String(monitor.limit) },
				{ label: "Record", value: monitor.path },
				{ label: "Log", value: monitor.logPath },
				...(monitor.stoppedAt ? [{ label: "Stopped", value: monitor.stoppedAt }] : []),
				...(monitor.signal ? [{ label: "Signal", value: monitor.signal }] : []),
			],
			{ indent: 3, labelWidth: 9 },
		),
	];
	if (monitor.recentCycles?.length) {
		lines.push("", renderDisplaySection("Recent cycles"));
		for (const cycle of monitor.recentCycles.slice(-6)) {
			const score = cycle.score === null ? "not scored" : `${cycle.score}/100`;
			lines.push(
				` - ${cycle.timestamp}: ${score}, ${cycle.diagnostics} finding${cycle.diagnostics === 1 ? "" : "s"}, ${changedFilesText(cycle.changedFiles)}`,
			);
			if (cycle.repaired) lines.push("   repair session triggered");
		}
	}
	return `${lines.join("\n")}\n`;
};

const readMonitorSummary = (root: string, monitor?: string): AgentMonitorSummary => {
	const monitorPath = resolveAgentMonitorPath(root, monitor);
	if (!monitorPath) {
		throw new Error(monitor ? `No matching agent monitor: ${monitor}` : "No agent monitors found.");
	}
	const record = readAgentMonitorRecord(monitorPath);
	if (!record) throw new Error(`Could not read agent monitor record: ${monitorPath}`);
	return summarizeAgentMonitor(monitorPath, record);
};

export const agentMonitorListCommand = async (
	directory: string,
	options: MonitorListOptions,
): Promise<void> => {
	try {
		const root = await resolveAgentGitRoot(directory);
		process.stdout.write(
			renderAgentMonitorList({ root, monitors: listAgentMonitors(root, options) }),
		);
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
};

export const agentMonitorShowCommand = async (
	monitor: string | undefined,
	options: MonitorRootOptions,
): Promise<void> => {
	try {
		const root = await resolveAgentGitRoot(options.root);
		process.stdout.write(renderAgentMonitorShow(readMonitorSummary(root, monitor)));
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
};

export const stopAgentMonitor = async (
	root: string,
	monitor: string | undefined,
	options: { force: boolean },
): Promise<AgentMonitorSummary> => {
	const summary = readMonitorSummary(root, monitor);
	if (summary.status === "stopped") {
		throw new Error(`Agent monitor ${summary.id} is already stopped.`);
	}
	const signal = options.force ? "SIGKILL" : "SIGTERM";
	const alreadyExited = !isProcessRunning(summary.pid);
	if (!alreadyExited && summary.pid) signalMonitorProcess(summary.pid, signal);
	const updated: AgentMonitorRecord = {
		...summary,
		stoppedAt: new Date().toISOString(),
		signal,
	};
	writeAgentMonitorRecord(root, updated);
	return summarizeAgentMonitor(summary.path, updated);
};

export const signalMonitorProcess = (pid: number, signal: NodeJS.Signals): void => {
	if (process.platform !== "win32") {
		try {
			process.kill(-pid, signal);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
	}
	process.kill(pid, signal);
};

export const agentMonitorStopCommand = async (
	monitor: string | undefined,
	options: MonitorStopOptions,
): Promise<void> => {
	try {
		const root = await resolveAgentGitRoot(options.root);
		const stopped = await stopAgentMonitor(root, monitor, { force: options.force });
		process.stdout.write(
			`${[
				renderDisplaySection("Stopped monitor"),
				...renderDisplayRows([
					{ label: "Monitor", value: stopped.id },
					...(stopped.pid ? [{ label: "PID", value: String(stopped.pid) }] : []),
					{ label: "Signal", value: stopped.signal ?? (options.force ? "SIGKILL" : "SIGTERM") },
					{ label: "Status", value: stopped.status },
				]),
				"",
				renderDisplaySection("Next"),
				...renderDisplayCommandRows([
					{ label: "Inspect", command: `aislop agent monitor show ${stopped.id}` },
				]),
				"",
			].join("\n")}`,
		);
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
};
