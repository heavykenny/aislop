import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
	type AgentMonitorRecord,
	agentMonitorPath,
	buildAgentMonitorId,
	updateAgentMonitorRecord,
	writeAgentMonitorRecord,
} from "../agents/monitor-store.js";
import { prepareAgentLocalState } from "../agents/worktree.js";
import {
	renderDisplayCommandRows,
	renderDisplayRows,
	renderDisplaySection,
} from "../ui/display.js";
import type { AgentMonitorOptions } from "./agent-monitor-types.js";

interface MonitorBackgroundLaunch {
	monitorId: string;
	recordPath: string;
	logPath: string;
	pid: number | undefined;
}

const cliPath = (): string => {
	const arg = process.argv[1];
	if (arg && fs.existsSync(arg)) return arg;
	return path.resolve("dist/cli.js");
};

const addFlag = (args: string[], flag: string, enabled: boolean): void => {
	if (enabled) args.push(flag);
};

const addOption = (args: string[], flag: string, value: string | number | undefined): void => {
	if (value === undefined || value === "") return;
	args.push(flag, String(value));
};

export const buildBackgroundMonitorArgs = (
	directory: string,
	options: AgentMonitorOptions,
): string[] => {
	const args = ["agent", "monitor", directory];
	addOption(args, "--provider", options.provider);
	addOption(args, "--target-score", options.targetScore);
	addOption(args, "--max-turns", options.maxTurns);
	addOption(args, "--limit", options.limit);
	addFlag(args, "--in-place", options.inPlace);
	addFlag(args, "--no-fix", options.noFix);
	addFlag(args, "--repair", options.repair);
	addOption(args, "--interval", options.interval);
	addOption(args, "--debounce", options.debounce);
	return args;
};

export const launchMonitorInBackground = async (
	directory: string,
	options: AgentMonitorOptions,
): Promise<MonitorBackgroundLaunch> => {
	const { root } = await prepareAgentLocalState(directory);
	const monitorId = buildAgentMonitorId();
	const logDir = path.join(root, ".aislop", "agent", "logs");
	fs.mkdirSync(logDir, { recursive: true });
	const logPath = path.join(logDir, `${monitorId}.log`);
	const logFd = fs.openSync(logPath, "a");
	const record: AgentMonitorRecord = {
		id: monitorId,
		root,
		requestedDirectory: path.resolve(directory),
		startedAt: new Date().toISOString(),
		provider: options.provider,
		providerSource: options.providerSource,
		providerPreference: options.providerPreference,
		repair: options.repair,
		inPlace: options.inPlace,
		interval: options.interval,
		debounce: options.debounce,
		targetScore: options.targetScore,
		maxTurns: options.maxTurns,
		limit: options.limit,
		noFix: options.noFix,
		logPath,
		recentCycles: [],
	};
	writeAgentMonitorRecord(root, record);
	const child = spawn(
		process.execPath,
		[cliPath(), ...buildBackgroundMonitorArgs(directory, options)],
		{
			cwd: root,
			detached: true,
			env: {
				...process.env,
				AISLOP_AGENT_MONITOR_BACKGROUND: "1",
				AISLOP_AGENT_MONITOR_ID: monitorId,
				AISLOP_NO_TELEMETRY: "1",
				AISLOP_NO_UPDATE_NOTIFIER: "1",
				NO_COLOR: "1",
			},
			stdio: ["ignore", logFd, logFd],
		},
	);
	child.unref();
	fs.closeSync(logFd);
	updateAgentMonitorRecord(root, monitorId, (current) => ({ ...current, pid: child.pid }));
	return {
		monitorId,
		recordPath: agentMonitorPath(root, monitorId),
		logPath,
		pid: child.pid,
	};
};

export const renderMonitorBackgroundLaunch = (launch: MonitorBackgroundLaunch): void => {
	process.stdout.write(
		`${[
			renderDisplaySection("Background monitor"),
			...renderDisplayRows([
				{ label: "Monitor", value: launch.monitorId },
				...(launch.pid ? [{ label: "PID", value: String(launch.pid) }] : []),
				{ label: "Record", value: launch.recordPath },
				{ label: "Log", value: launch.logPath },
			]),
			"",
			renderDisplaySection("Next"),
			...renderDisplayCommandRows([
				{ label: "Inspect", command: `aislop agent monitor show ${launch.monitorId}` },
				{ label: "List", command: "aislop agent monitor list" },
			]),
			"",
		].join("\n")}`,
	);
};
