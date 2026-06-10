import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "../engines/types.js";

interface AgentSessionEvent {
	type: string;
	timestamp: string;
	sessionId: string;
	[key: string]: unknown;
}

export interface AgentSessionRecorder {
	id: string;
	path: string;
	append: (type: string, payload?: Record<string, unknown>) => void;
}

const pad = (value: number): string => String(value).padStart(2, "0");

export const buildAgentSessionId = (date = new Date(), pid = process.pid): string =>
	[
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
		`${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
		String(pid),
	].join("-");

export const summarizeAgentFinding = (
	diagnostic: Diagnostic,
): Record<string, string | number | boolean> => ({
	filePath: diagnostic.filePath,
	rule: diagnostic.rule,
	engine: diagnostic.engine,
	severity: diagnostic.severity,
	message: diagnostic.message,
	line: diagnostic.line,
	column: diagnostic.column,
	fixable: diagnostic.fixable,
});

export const createAgentSessionRecorder = (
	root: string,
	options: { date?: Date; id?: string; pid?: number } = {},
): AgentSessionRecorder => {
	const id = options.id ?? buildAgentSessionId(options.date, options.pid);
	const sessionDir = path.join(root, ".aislop", "agent", "sessions");
	const sessionPath = path.join(sessionDir, `${id}.jsonl`);
	fs.mkdirSync(sessionDir, { recursive: true });

	const append = (type: string, payload: Record<string, unknown> = {}): void => {
		const event: AgentSessionEvent = {
			type,
			timestamp: new Date().toISOString(),
			sessionId: id,
			...payload,
		};
		fs.appendFileSync(sessionPath, `${JSON.stringify(event)}\n`, "utf-8");
	};

	return { id, path: sessionPath, append };
};
