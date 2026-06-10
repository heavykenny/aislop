import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createAgentSessionRecorder } from "../agents/session.js";
import { prepareAgentLocalState } from "../agents/worktree.js";
import {
	renderDisplayCommandRows,
	renderDisplayRows,
	renderDisplaySection,
} from "../ui/display.js";
import type { AgentOptions } from "./agent-types.js";

interface BackgroundLaunch {
	sessionId: string;
	transcriptPath: string;
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

export const buildBackgroundAgentArgs = (directory: string, options: AgentOptions): string[] => {
	const args = ["agent", directory];
	addOption(args, "--provider", options.provider);
	addOption(args, "--target-score", options.targetScore);
	addOption(args, "--max-turns", options.maxTurns);
	addOption(args, "--limit", options.limit);
	addFlag(args, "--in-place", options.inPlace);
	addFlag(args, "--apply", options.apply);
	addFlag(args, "--yes", options.yes);
	addFlag(args, "--no-fix", options.noFix);
	addFlag(args, "--commit", options.commit && !options.pr);
	addFlag(args, "--pr", options.pr);
	addOption(args, "--branch", options.branch);
	addOption(args, "--base", options.base);
	addOption(args, "--commit-message", options.commitMessage);
	addOption(args, "--title", options.prTitle);
	addFlag(args, "--ready", options.ready);
	addFlag(args, "--no-keep-worktree", !options.keepWorktree);
	addFlag(args, "--cleanup", options.cleanup);
	return args;
};

export const launchAgentInBackground = async (
	directory: string,
	options: AgentOptions,
): Promise<BackgroundLaunch> => {
	if (options.apply && !options.yes) {
		throw new Error("Background apply cannot prompt. Re-run with `--apply --yes`.");
	}
	const { root } = await prepareAgentLocalState(directory);
	const session = createAgentSessionRecorder(root);
	const logDir = path.join(root, ".aislop", "agent", "logs");
	fs.mkdirSync(logDir, { recursive: true });
	const logPath = path.join(logDir, `${session.id}.log`);
	const logFd = fs.openSync(logPath, "a");
	session.append("session.queued", {
		mode: "background",
		root,
		requestedDirectory: path.resolve(directory),
		providerSelection: options.provider,
		providerSource: options.providerSource,
		providerPreference: options.providerPreference,
		targetScore: options.targetScore,
		maxTurns: options.maxTurns,
		limit: options.limit,
		logPath,
		publish: {
			commit: options.commit,
			pr: options.pr,
			branch: options.branch,
			base: options.base,
			ready: options.ready,
		},
	});
	const child = spawn(
		process.execPath,
		[cliPath(), ...buildBackgroundAgentArgs(directory, options)],
		{
			cwd: root,
			detached: true,
			env: {
				...process.env,
				AISLOP_AGENT_BACKGROUND: "1",
				AISLOP_AGENT_SESSION_ID: session.id,
				AISLOP_NO_TELEMETRY: "1",
				AISLOP_NO_UPDATE_NOTIFIER: "1",
				NO_COLOR: "1",
			},
			stdio: ["ignore", logFd, logFd],
		},
	);
	child.unref();
	fs.closeSync(logFd);
	session.append("background.started", {
		pid: child.pid,
		logPath,
	});
	return {
		sessionId: session.id,
		transcriptPath: session.path,
		logPath,
		pid: child.pid,
	};
};

export const renderBackgroundLaunch = (launch: BackgroundLaunch): void => {
	process.stdout.write(
		`${[
			renderDisplaySection("Background session"),
			...renderDisplayRows([
				{ label: "Session", value: launch.sessionId },
				...(launch.pid ? [{ label: "PID", value: String(launch.pid) }] : []),
				{ label: "Transcript", value: launch.transcriptPath },
				{ label: "Log", value: launch.logPath },
			]),
			"",
			renderDisplaySection("Next"),
			...renderDisplayCommandRows([
				{ label: "Inspect", command: `aislop agent show ${launch.sessionId}` },
				{ label: "List", command: "aislop agent sessions" },
			]),
			"",
		].join("\n")}`,
	);
};
