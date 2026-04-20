import fs from "node:fs";
import path from "node:path";
import { findConfigDir, loadConfig, RULES_FILE } from "../../config/index.js";
import { runEngines } from "../../engines/orchestrator.js";
import type { Diagnostic, EngineContext, EngineName } from "../../engines/types.js";
import { calculateScore } from "../../scoring/index.js";
import { discoverProject } from "../../utils/discover.js";
import { filterProjectFiles } from "../../utils/source-files.js";
import { buildFeedback } from "../feedback.js";

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

const existingAbsolutePaths = (cwd: string, files: string[]): string[] =>
	files
		.map((f) => (path.isAbsolute(f) ? f : path.join(cwd, f)))
		.filter((p) => {
			try {
				return fs.statSync(p).isFile();
			} catch {
				return false;
			}
		});

const runScopedScan = async (
	cwd: string,
	filePaths: string[],
): Promise<{ diagnostics: Diagnostic[]; score: number; rootDirectory: string }> => {
	const project = await discoverProject(cwd);
	const config = loadConfig(cwd);
	const configDir = findConfigDir(project.rootDirectory);
	const rulesPath = configDir ? path.join(configDir, RULES_FILE) : undefined;

	const context: EngineContext = {
		rootDirectory: project.rootDirectory,
		languages: project.languages,
		frameworks: project.frameworks,
		files: filterProjectFiles(project.rootDirectory, filePaths),
		installedTools: project.installedTools,
		config: {
			quality: config.quality,
			// Network-bound audit exceeds Claude's hook timeout, so always off here.
			security: { audit: false, auditTimeout: 0 },
			architectureRulesPath: config.engines.architecture ? rulesPath : undefined,
		},
	};

	const enabled: Record<EngineName, boolean> = {
		format: config.engines.format,
		lint: config.engines.lint,
		"code-quality": config.engines["code-quality"],
		"ai-slop": config.engines["ai-slop"],
		architecture: config.engines.architecture,
		security: false,
	};

	const results = await runEngines(context, enabled);
	const diagnostics = results.flatMap((r) => r.diagnostics);
	const { score } = calculateScore(
		diagnostics,
		config.scoring.weights,
		config.scoring.thresholds,
		project.sourceFileCount,
		config.scoring.smoothing,
	);

	return { diagnostics, score, rootDirectory: project.rootDirectory };
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
	const files = extractFiles(input);
	const absFiles = existingAbsolutePaths(cwd, files);

	if (absFiles.length === 0) return 0;

	try {
		const { diagnostics, score, rootDirectory } = await runScopedScan(cwd, absFiles);
		const feedback = buildFeedback(diagnostics, score, rootDirectory);
		const envelope = renderClaudeOutput(JSON.stringify(feedback));
		write(JSON.stringify(envelope));
		return 0;
	} catch {
		// A hook crash must never fail the user's Edit tool call.
		return 0;
	}
};
