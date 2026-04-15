import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "../engines/types.js";
import { highlighter } from "../utils/highlighter.js";
import { logger } from "../utils/logger.js";

const CONTEXT_LINES = 3;
const MAX_DIAGNOSTICS_PER_FILE = 10;
const MAX_FILES = 20;

// ─── Agent configs ───────────────────────────────────────────────────────────

interface CliAgent {
	type: "cli";
	bin: string;
	args: (prompt: string) => string[];
}

interface EditorAgent {
	type: "editor";
	bin: string;
}

type AgentConfig = CliAgent | EditorAgent;

const AGENT_CONFIGS: Record<string, AgentConfig> = {
	// CLI agents — launch with prompt directly
	claude: { type: "cli", bin: "claude", args: (p) => [p] },
	codex: { type: "cli", bin: "codex", args: (p) => [p] },
	amp: { type: "cli", bin: "amp", args: (p) => [p] },
	antigravity: { type: "cli", bin: "antigravity", args: (p) => [p] },
	"deep-agents": { type: "cli", bin: "deep-agents", args: (p) => [p] },
	gemini: { type: "cli", bin: "gemini", args: (p) => [p] },
	kimi: { type: "cli", bin: "kimi", args: (p) => [p] },
	opencode: { type: "cli", bin: "opencode", args: (p) => ["run", p] },
	warp: { type: "cli", bin: "warp", args: (p) => [p] },
	aider: { type: "cli", bin: "aider", args: (p) => ["--message", p] },
	goose: { type: "cli", bin: "goose", args: (p) => ["run", p] },

	// Editor agents — open editor + copy prompt to clipboard
	cursor: { type: "editor", bin: "cursor" },
	windsurf: { type: "editor", bin: "windsurf" },
	vscode: { type: "editor", bin: "code" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getCodeSnippet = (rootDirectory: string, diagnostic: Diagnostic): string | null => {
	if (diagnostic.line <= 0) return null;

	const absolutePath = path.resolve(rootDirectory, diagnostic.filePath);
	let content: string;
	try {
		content = fs.readFileSync(absolutePath, "utf-8");
	} catch {
		return null;
	}

	const lines = content.split("\n");
	const startLine = Math.max(0, diagnostic.line - 1 - CONTEXT_LINES);
	const endLine = Math.min(lines.length, diagnostic.line + CONTEXT_LINES);

	const snippet: string[] = [];
	for (let i = startLine; i < endLine; i++) {
		const lineNum = i + 1;
		const marker = lineNum === diagnostic.line ? "→" : " ";
		snippet.push(`${marker} ${String(lineNum).padStart(4)} │ ${lines[i]}`);
	}

	return snippet.join("\n");
};

const groupByFile = (
	diagnostics: Diagnostic[],
): Array<{ filePath: string; diagnostics: Diagnostic[] }> => {
	const map = new Map<string, Diagnostic[]>();
	for (const d of diagnostics) {
		const list = map.get(d.filePath) ?? [];
		list.push(d);
		map.set(d.filePath, list);
	}

	return [...map.entries()]
		.map(([filePath, diags]) => ({ filePath, diagnostics: diags }))
		.sort((a, b) => {
			const aErrors = a.diagnostics.filter((d) => d.severity === "error").length;
			const bErrors = b.diagnostics.filter((d) => d.severity === "error").length;
			if (aErrors !== bErrors) return bErrors - aErrors;
			return b.diagnostics.length - a.diagnostics.length;
		});
};

const isInstalled = (bin: string): boolean => {
	const cmd = process.platform === "win32" ? "where" : "which";
	const result = spawnSync(cmd, [bin], { encoding: "utf-8" });
	return result.status === 0;
};

const copyToClipboard = (text: string): boolean => {
	const commands: Record<string, string[]> = {
		darwin: ["pbcopy"],
		linux: ["xclip", "-selection", "clipboard"],
		win32: ["clip"],
	};
	const args = commands[process.platform];
	if (!args) return false;

	const [bin, ...rest] = args;
	const result = spawnSync(bin, rest, { input: text, encoding: "utf-8" });
	return result.status === 0;
};

// ─── Prompt builder ──────────────────────────────────────────────────────────

const buildAgentPrompt = (
	rootDirectory: string,
	diagnostics: Diagnostic[],
	score: number,
): string => {
	const groups = groupByFile(diagnostics).slice(0, MAX_FILES);
	const errorCount = diagnostics.filter((d) => d.severity === "error").length;
	const warningCount = diagnostics.filter((d) => d.severity === "warning").length;

	const lines: string[] = [
		`Fix the following ${diagnostics.length} code quality issue${diagnostics.length === 1 ? "" : "s"} found by aislop (current score: ${score}/100).`,
		"",
		`Summary: ${errorCount} error${errorCount === 1 ? "" : "s"}, ${warningCount} warning${warningCount === 1 ? "" : "s"} across ${groups.length} file${groups.length === 1 ? "" : "s"}.`,
		"",
	];

	for (const group of groups) {
		lines.push(`## ${group.filePath}`);
		lines.push("");

		const fileDiags = group.diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE);
		for (const d of fileDiags) {
			const severity =
				d.severity === "error" ? "ERROR" : d.severity === "warning" ? "WARN" : "INFO";
			const location = d.line > 0 ? ` (line ${d.line})` : "";
			lines.push(`**[${severity}]** \`${d.rule}\`${location}: ${d.message}`);

			if (d.help) {
				lines.push(`> ${d.help}`);
			}

			const snippet = getCodeSnippet(rootDirectory, d);
			if (snippet) {
				lines.push("```");
				lines.push(snippet);
				lines.push("```");
			}
			lines.push("");
		}

		if (group.diagnostics.length > MAX_DIAGNOSTICS_PER_FILE) {
			lines.push(
				`_...and ${group.diagnostics.length - MAX_DIAGNOSTICS_PER_FILE} more issue${group.diagnostics.length - MAX_DIAGNOSTICS_PER_FILE === 1 ? "" : "s"} in this file._`,
			);
			lines.push("");
		}
	}

	const totalGroups = groupByFile(diagnostics).length;
	if (totalGroups > MAX_FILES) {
		const remaining = totalGroups - MAX_FILES;
		lines.push(`_...and ${remaining} more file${remaining === 1 ? "" : "s"} with issues._`);
		lines.push("");
	}

	lines.push("---");
	lines.push("Fix each issue following the guidance above. Prioritize errors over warnings.");
	lines.push(
		"After making changes, run `npx aislop scan` to verify all issues are resolved and the score improves.",
	);

	return lines.join("\n");
};

// ─── Public API ──────────────────────────────────────────────────────────────

const SUPPORTED_AGENT_NAMES = Object.keys(AGENT_CONFIGS);

export const launchAgent = (
	agent: string,
	rootDirectory: string,
	diagnostics: Diagnostic[],
	score: number,
): void => {
	if (diagnostics.length === 0) {
		logger.success("  No remaining issues — nothing to hand off.");
		return;
	}

	const config = AGENT_CONFIGS[agent];
	if (!config) {
		logger.error(`  Unknown agent: ${agent}`);
		logger.dim(`  Supported: ${SUPPORTED_AGENT_NAMES.join(", ")}`);
		return;
	}

	if (!isInstalled(config.bin)) {
		logger.error(`  ${agent} is not installed or not in PATH.`);
		logger.dim(
			`  Install it first, or use ${highlighter.info("fix -p")} to print the prompt manually.`,
		);
		return;
	}

	const prompt = buildAgentPrompt(rootDirectory, diagnostics, score);

	if (config.type === "editor") {
		const copied = copyToClipboard(prompt);
		logger.break();
		if (copied) {
			logger.log(
				`  ${highlighter.success("✓")} Prompt copied to clipboard (${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"})`,
			);
		} else {
			logger.warn("  Could not copy to clipboard. Use fix --prompt to print it instead.");
		}
		logger.log(
			`  ${highlighter.info("→")} Opening ${highlighter.bold(agent)}... paste the prompt into the agent chat.`,
		);
		logger.break();

		spawnSync(config.bin, ["."], {
			cwd: rootDirectory,
			stdio: "inherit",
		});
		return;
	}

	// CLI agent — launch with prompt directly
	logger.break();
	logger.log(
		`  ${highlighter.info("→")} Opening ${highlighter.bold(agent)} with ${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"}...`,
	);
	logger.break();

	spawnSync(config.bin, config.args(prompt), {
		cwd: rootDirectory,
		stdio: "inherit",
	});
};

export const printPrompt = (
	rootDirectory: string,
	diagnostics: Diagnostic[],
	score: number,
): void => {
	if (diagnostics.length === 0) {
		logger.success("  No remaining issues — nothing to generate.");
		return;
	}

	const prompt = buildAgentPrompt(rootDirectory, diagnostics, score);

	// If stdout is piped, output raw prompt for piping
	if (!process.stdout.isTTY) {
		process.stdout.write(prompt);
		return;
	}

	// TTY: print with framing
	logger.break();
	logger.log(highlighter.bold("Agent prompt"));
	logger.log(highlighter.dim("  Copy the prompt below, or pipe it: fix -p | pbcopy"));
	logger.log(
		highlighter.dim("  Or launch directly: fix --claude, fix --cursor, fix --codex, etc."),
	);
	logger.log(
		highlighter.dim("  Editor agents (--cursor, --windsurf, --vscode) auto-copy to clipboard."),
	);
	logger.break();
	logger.log(highlighter.dim("╭─────────────────────────────────────────────────────────╮"));
	for (const line of prompt.split("\n")) {
		logger.log(`  ${line}`);
	}
	logger.log(highlighter.dim("╰─────────────────────────────────────────────────────────╯"));
	logger.break();
};
