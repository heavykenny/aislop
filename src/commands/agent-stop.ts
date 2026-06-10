import { createAgentSessionRecorder } from "../agents/session.js";
import {
	type AgentSessionEvent,
	readAgentSessionEvents,
	resolveAgentSessionPath,
	summarizeAgentSession,
} from "../agents/session-store.js";
import {
	renderDisplayCommandRows,
	renderDisplayRows,
	renderDisplaySection,
} from "../ui/display.js";
import { log } from "../ui/logger.js";
import { resolveAgentGitRoot } from "./agent-session-root.js";

interface AgentStopOptions {
	root: string;
	force: boolean;
}

interface AgentStopResult {
	sessionId: string;
	pid: number;
	signal: NodeJS.Signals;
	alreadyExited: boolean;
}

export const backgroundPidFromEvents = (events: AgentSessionEvent[]): number | null => {
	for (const event of [...events].reverse()) {
		if (event.type === "background.started" && typeof event.pid === "number") return event.pid;
	}
	return null;
};

const isProcessAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
};

const sendSignal = (pid: number, signal: NodeJS.Signals): void => {
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

const stopAgentSession = async (
	root: string,
	session: string | undefined,
	options: { force: boolean },
): Promise<AgentStopResult> => {
	const sessionPath = resolveAgentSessionPath(root, session);
	if (!sessionPath) {
		throw new Error(session ? `No matching agent session: ${session}` : "No agent sessions found.");
	}
	const events = readAgentSessionEvents(sessionPath);
	const summary = summarizeAgentSession(sessionPath, events);
	if (summary.status !== "running") {
		throw new Error(`Agent session ${summary.id} is ${summary.status}; nothing to stop.`);
	}
	const pid = backgroundPidFromEvents(events);
	if (!pid) {
		throw new Error(`Agent session ${summary.id} does not have a background process id.`);
	}
	const signal: NodeJS.Signals = options.force ? "SIGKILL" : "SIGTERM";
	const recorder = createAgentSessionRecorder(root, { id: summary.id });
	recorder.append("background.stop_requested", { pid, signal });
	const alreadyExited = !isProcessAlive(pid);
	if (!alreadyExited) sendSignal(pid, signal);
	recorder.append("background.stopped", { pid, signal, alreadyExited });
	return { sessionId: summary.id, pid, signal, alreadyExited };
};

const renderAgentStopResult = (result: AgentStopResult): void => {
	process.stdout.write(
		`${[
			renderDisplaySection("Stopped session"),
			...renderDisplayRows([
				{ label: "Session", value: result.sessionId },
				{ label: "PID", value: String(result.pid) },
				{ label: "Signal", value: result.signal },
			]),
			"",
		].join("\n")}`,
	);
	if (result.alreadyExited) {
		log.warn("Process was already gone; marked the session stopped.");
		return;
	}
	log.success("Stop signal sent.");
	process.stdout.write(
		`${[
			renderDisplaySection("Next"),
			...renderDisplayCommandRows([
				{ label: "Inspect", command: `aislop agent show ${result.sessionId}` },
			]),
			"",
		].join("\n")}`,
	);
};

export const agentStopCommand = async (
	session: string | undefined,
	options: AgentStopOptions,
): Promise<void> => {
	try {
		const root = await resolveAgentGitRoot(options.root);
		renderAgentStopResult(await stopAgentSession(root, session, { force: options.force }));
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
};
