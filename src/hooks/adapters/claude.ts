import path from "node:path";
import { buildHookScanCompletedProps, track } from "../../telemetry/index.js";
import { buildFeedback } from "../feedback.js";
import { acquireHookLock } from "../io/scan-lock.js";
import { resolveHookFiles, runScopedScan } from "../io/scoped-scan.js";
import {
	appendSessionFiles,
	captureBaseline,
	clearSessionFiles,
	readBaseline,
	readSessionFiles,
} from "../quality-gate/baseline.js";

interface ClaudeHookStdin {
	hook_event_name?: string;
	tool_name?: string;
	tool_input?: {
		file_path?: string;
		edits?: { file_path?: string }[];
	};
	cwd?: string;
	session_id?: string;
}

interface ClaudeHookOutput {
	decision?: "block";
	reason?: string;
	hookSpecificOutput: {
		hookEventName: "PostToolUse";
		additionalContext: string;
	};
}

const extractFiles = (stdin: ClaudeHookStdin): string[] => {
	const files = new Set<string>();
	const input = stdin.tool_input ?? {};
	if (typeof input.file_path === "string" && input.file_path.length > 0) {
		files.add(input.file_path);
	}
	if (Array.isArray(input.edits)) {
		for (const e of input.edits) {
			if (e && typeof e.file_path === "string" && e.file_path.length > 0) {
				files.add(e.file_path);
			}
		}
	}
	return Array.from(files);
};

export const parseClaudeStdin = (raw: string): ClaudeHookStdin => {
	if (!raw.trim()) return {};
	try {
		return JSON.parse(raw) as ClaudeHookStdin;
	} catch {
		return {};
	}
};

const readStdin = async (): Promise<string> => {
	if (process.stdin.isTTY) return "";
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf-8");
};

export const renderClaudeOutput = (
	additional: string,
	block?: { reason: string },
): ClaudeHookOutput => {
	const out: ClaudeHookOutput = {
		hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: additional,
		},
	};
	if (block) {
		out.decision = "block";
		out.reason = block.reason;
	}
	return out;
};

export const runClaudeHook = async (
	deps: { stdin?: () => Promise<string>; write?: (s: string) => void } = {},
): Promise<number> => {
	const getStdin = deps.stdin ?? readStdin;
	const write = deps.write ?? ((s: string) => process.stdout.write(s));

	const raw = await getStdin();
	const input = parseClaudeStdin(raw);
	const cwd = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd();
	const files = resolveHookFiles(cwd, extractFiles(input));

	if (files.length === 0) return 0;
	const release = acquireHookLock(cwd);
	if (!release) return 0;

	try {
		const { diagnostics, score, rootDirectory } = await runScopedScan(cwd, files);
		const baseline = readBaseline(cwd);
		appendSessionFiles(cwd, files);
		const feedback = buildFeedback(
			diagnostics,
			score,
			rootDirectory,
			baseline
				? { score: baseline.score, findingFingerprints: baseline.findingFingerprints }
				: undefined,
			{ agent: "claude", touchedFiles: files },
		);
		track({
			event: "hook_scan_completed",
			properties: buildHookScanCompletedProps({
				agent: "claude",
				score,
				scoreDelta: baseline ? score - baseline.score : null,
				findingCount: diagnostics.length,
				fileCount: files.length,
			}),
		});
		const envelope = renderClaudeOutput(JSON.stringify(feedback));
		write(JSON.stringify(envelope));
		return 0;
	} catch {
		// A hook crash must never fail the user's Edit tool call.
		return 0;
	} finally {
		release();
	}
};

interface ClaudeFileChangedStdin {
	cwd?: string;
	file_path?: string;
}

export const parseClaudeFileChangedStdin = (raw: string): ClaudeFileChangedStdin => {
	if (!raw.trim()) return {};
	try {
		return JSON.parse(raw) as ClaudeFileChangedStdin;
	} catch {
		return {};
	}
};

export const runClaudeFileChangedHook = async (
	deps: { stdin?: () => Promise<string>; write?: (s: string) => void } = {},
): Promise<number> => {
	const getStdin = deps.stdin ?? readStdin;
	const write = deps.write ?? ((s: string) => process.stdout.write(s));

	const raw = await getStdin();
	const input = parseClaudeFileChangedStdin(raw);
	const cwd = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd();

	const release = acquireHookLock(cwd);
	if (!release) return 0;
	try {
		const result = await captureBaseline(cwd);
		const changed = input.file_path
			? path.relative(cwd, input.file_path) || input.file_path
			: "<unknown>";
		const additional = JSON.stringify({
			schema: "aislop.hook.v2",
			event: "file_changed",
			file: changed,
			message: `Watched file changed (${changed}). aislop refreshed the baseline — score: ${result.score}.`,
			baseline: { score: result.score, fileCount: result.fileCount },
		});
		const envelope = renderClaudeOutput(additional);
		write(JSON.stringify(envelope));
		return 0;
	} catch {
		return 0;
	} finally {
		release();
	}
};

interface ClaudeStopStdin {
	cwd?: string;
	stop_hook_active?: boolean;
}

export const parseClaudeStopStdin = (raw: string): ClaudeStopStdin => {
	if (!raw.trim()) return {};
	try {
		return JSON.parse(raw) as ClaudeStopStdin;
	} catch {
		return {};
	}
};

export const runClaudeStopHook = async (
	deps: { stdin?: () => Promise<string>; write?: (s: string) => void } = {},
): Promise<number> => {
	const getStdin = deps.stdin ?? readStdin;
	const write = deps.write ?? ((s: string) => process.stdout.write(s));

	const raw = await getStdin();
	const input = parseClaudeStopStdin(raw);
	const cwd = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd();

	// Avoid infinite Stop loops if the model has already replied to a previous block.
	if (input.stop_hook_active) return 0;

	const baseline = readBaseline(cwd);
	if (!baseline) return 0;

	const sessionFiles = readSessionFiles(cwd);
	if (sessionFiles.length === 0) return 0;

	const release = acquireHookLock(cwd);
	if (!release) return 0;
	try {
		const { diagnostics, score, rootDirectory } = await runScopedScan(cwd, sessionFiles);
		const feedback = buildFeedback(
			diagnostics,
			score,
			rootDirectory,
			{
				score: baseline.score,
				findingFingerprints: baseline.findingFingerprints,
			},
			{ agent: "claude", touchedFiles: sessionFiles },
		);
		if (!feedback.regressed) {
			clearSessionFiles(cwd);
			return 0;
		}
		const envelope = renderClaudeOutput(JSON.stringify(feedback), {
			reason: `aislop: score dropped from ${baseline.score} to ${score}. Fix the ${feedback.counts.total} finding${feedback.counts.total === 1 ? "" : "s"} before finishing.`,
		});
		write(JSON.stringify(envelope));
		return 0;
	} catch {
		return 0;
	} finally {
		release();
	}
};
