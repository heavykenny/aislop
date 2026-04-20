import path from "node:path";
import { buildFeedback } from "../feedback.js";
import { acquireHookLock } from "../io/scan-lock.js";
import { resolveHookFiles, runScopedScan } from "../io/scoped-scan.js";

interface CursorHookStdin {
	file_path?: string;
	edits?: { file_path?: string }[];
	cwd?: string;
	tool_name?: string;
	tool_input?: {
		file_path?: string;
		edits?: { file_path?: string }[];
	};
}

interface CursorHookOutput {
	hookSpecificOutput: {
		hookEventName: "afterFileEdit" | "postToolUse";
		additionalContext: string;
	};
}

const extractFiles = (stdin: CursorHookStdin): string[] => {
	const files = new Set<string>();
	if (typeof stdin.file_path === "string" && stdin.file_path.length > 0) {
		files.add(stdin.file_path);
	}
	if (Array.isArray(stdin.edits)) {
		for (const e of stdin.edits) {
			if (e && typeof e.file_path === "string" && e.file_path.length > 0) {
				files.add(e.file_path);
			}
		}
	}
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

export const parseCursorStdin = (raw: string): CursorHookStdin => {
	if (!raw.trim()) return {};
	try {
		return JSON.parse(raw) as CursorHookStdin;
	} catch {
		return {};
	}
};

export const renderCursorOutput = (
	additional: string,
	event: "afterFileEdit" | "postToolUse" = "afterFileEdit",
): CursorHookOutput => ({
	hookSpecificOutput: {
		hookEventName: event,
		additionalContext: additional,
	},
});

const readStdin = async (): Promise<string> => {
	if (process.stdin.isTTY) return "";
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf-8");
};

export const runCursorHook = async (
	deps: {
		stdin?: () => Promise<string>;
		write?: (s: string) => void;
		writeErr?: (s: string) => void;
	} = {},
): Promise<number> => {
	const getStdin = deps.stdin ?? readStdin;
	const write = deps.write ?? ((s: string) => process.stdout.write(s));
	const writeErr = deps.writeErr ?? ((s: string) => process.stderr.write(s));

	const raw = await getStdin();
	const input = parseCursorStdin(raw);
	const cwd = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd();
	const files = resolveHookFiles(cwd, extractFiles(input));

	if (files.length === 0) return 0;
	const release = acquireHookLock(cwd);
	if (!release) return 0;

	try {
		const { diagnostics, score, rootDirectory } = await runScopedScan(cwd, files);
		const feedback = buildFeedback(diagnostics, score, rootDirectory);
		const serialized = JSON.stringify(feedback);
		write(JSON.stringify(renderCursorOutput(serialized)));
		// Cursor's afterFileEdit is observational in some versions; mirror to stderr so the agent sees it either way.
		writeErr(`${serialized}\n`);
		return 0;
	} catch {
		return 0;
	} finally {
		release();
	}
};
