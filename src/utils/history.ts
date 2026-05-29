import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../config/index.js";
import { APP_VERSION } from "../version.js";

const HISTORY_FILE = "history.jsonl";

export interface HistoryRecord {
	timestamp: string;
	score: number;
	errors: number;
	warnings: number;
	files: number;
	cliVersion: string;
}

const isHistoryDisabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
	env.AISLOP_NO_HISTORY === "1";

const historyPath = (directory: string): string =>
	path.join(path.resolve(directory), CONFIG_DIR, HISTORY_FILE);

interface AppendHistoryInput {
	directory: string;
	score: number;
	errors: number;
	warnings: number;
	files: number;
}

/**
 * Append a compact scan record to .aislop/history.jsonl. Best-effort: never
 * throws, so a read-only checkout or missing config dir can't break a scan.
 */
export const appendHistory = (input: AppendHistoryInput): void => {
	if (isHistoryDisabled()) return;
	const configDir = path.join(path.resolve(input.directory), CONFIG_DIR);
	if (!fs.existsSync(configDir)) return;

	const record: HistoryRecord = {
		timestamp: new Date().toISOString(),
		score: input.score,
		errors: input.errors,
		warnings: input.warnings,
		files: input.files,
		cliVersion: APP_VERSION,
	};
	try {
		fs.appendFileSync(historyPath(input.directory), `${JSON.stringify(record)}\n`);
	} catch {
		// History is a convenience side effect; a failed write must not fail the scan.
	}
};

const isHistoryRecord = (value: unknown): value is HistoryRecord => {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.timestamp === "string" &&
		typeof record.score === "number" &&
		typeof record.errors === "number" &&
		typeof record.warnings === "number" &&
		typeof record.files === "number" &&
		typeof record.cliVersion === "string"
	);
};

export const readHistory = (directory: string): HistoryRecord[] => {
	const file = historyPath(directory);
	if (!fs.existsSync(file)) return [];

	const records: HistoryRecord[] = [];
	for (const line of fs.readFileSync(file, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (isHistoryRecord(parsed)) records.push(parsed);
		} catch {
			// Skip malformed lines rather than aborting the whole history read.
		}
	}
	return records;
};
