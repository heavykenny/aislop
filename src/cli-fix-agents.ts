export const FIX_AGENT_FLAGS: readonly Readonly<{
	flag: string;
	name: string;
	help: string;
}>[] = [
	{ flag: "claude", name: "claude", help: "open Claude Code to fix remaining issues" },
	{ flag: "codex", name: "codex", help: "open Codex to fix remaining issues" },
	{ flag: "cursor", name: "cursor", help: "open Cursor and copy prompt to clipboard" },
	{ flag: "windsurf", name: "windsurf", help: "open Windsurf and copy prompt to clipboard" },
	{ flag: "vscode", name: "vscode", help: "open VS Code and copy prompt to clipboard" },
	{ flag: "amp", name: "amp", help: "open Amp to fix remaining issues" },
	{ flag: "antigravity", name: "antigravity", help: "open Antigravity to fix remaining issues" },
	{ flag: "deep-agents", name: "deepAgents", help: "open Deep Agents to fix remaining issues" },
	{ flag: "gemini", name: "gemini", help: "open Gemini CLI to fix remaining issues" },
	{ flag: "kimi", name: "kimi", help: "open Kimi Code CLI to fix remaining issues" },
	{ flag: "opencode", name: "opencode", help: "open OpenCode to fix remaining issues" },
	{ flag: "warp", name: "warp", help: "open Warp to fix remaining issues" },
	{ flag: "aider", name: "aider", help: "open Aider to fix remaining issues" },
	{ flag: "goose", name: "goose", help: "open Goose to fix remaining issues" },
	{ flag: "pi", name: "pi", help: "open pi to fix remaining issues" },
	{ flag: "crush", name: "crush", help: "open Crush to fix remaining issues" },
];

export const matchFixAgent = (flags: Record<string, boolean | undefined>): string | undefined => {
	const hit = FIX_AGENT_FLAGS.find((a) => flags[a.name]);
	return hit?.flag;
};
