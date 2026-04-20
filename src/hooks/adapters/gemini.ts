import path from "node:path";
import { buildFeedback } from "../feedback.js";
import { acquireHookLock } from "../io/scan-lock.js";
import { resolveHookFiles, runScopedScan } from "../io/scoped-scan.js";

interface GeminiHookStdin {
	tool_name?: string;
	tool_input?: {
		file_path?: string;
		path?: string;
	};
	tool_response?: unknown;
	cwd?: string;
}

interface GeminiHookOutput {
	hookSpecificOutput: {
		hookEventName: "AfterTool";
		additionalContext: string;
	};
}

const extractFiles = (stdin: GeminiHookStdin): string[] => {
	const files = new Set<string>();
	const input = stdin.tool_input ?? {};
	if (typeof input.file_path === "string" && input.file_path.length > 0) files.add(input.file_path);
	if (typeof input.path === "string" && input.path.length > 0) files.add(input.path);
	return Array.from(files);
};

export const parseGeminiStdin = (raw: string): GeminiHookStdin => {
	if (!raw.trim()) return {};
	try {
		return JSON.parse(raw) as GeminiHookStdin;
	} catch {
		return {};
	}
};

export const renderGeminiOutput = (additional: string): GeminiHookOutput => ({
	hookSpecificOutput: {
		hookEventName: "AfterTool",
		additionalContext: additional,
	},
});

const readStdin = async (): Promise<string> => {
	if (process.stdin.isTTY) return "";
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf-8");
};

export const runGeminiHook = async (
	deps: { stdin?: () => Promise<string>; write?: (s: string) => void } = {},
): Promise<number> => {
	const getStdin = deps.stdin ?? readStdin;
	const write = deps.write ?? ((s: string) => process.stdout.write(s));

	const raw = await getStdin();
	const input = parseGeminiStdin(raw);
	const cwd = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd();
	const files = resolveHookFiles(cwd, extractFiles(input));

	if (files.length === 0) return 0;
	const release = acquireHookLock(cwd);
	if (!release) return 0;

	try {
		const { diagnostics, score, rootDirectory } = await runScopedScan(cwd, files);
		const feedback = buildFeedback(diagnostics, score, rootDirectory);
		write(JSON.stringify(renderGeminiOutput(JSON.stringify(feedback))));
		return 0;
	} catch {
		return 0;
	} finally {
		release();
	}
};
