import type { DisplayRow } from "./display.js";

export interface CommandReference {
	command: string;
	summary: string;
	flags?: string[];
}

const SCAN_FLAGS = [
	"--changes",
	"--staged",
	"--base <ref>",
	"-d, --verbose",
	"--json",
	"--sarif",
	"--format <format>",
	"--include <patterns>",
	"--exclude <patterns>",
];

const FIX_AGENT_FLAGS = [
	"--claude",
	"--codex",
	"--cursor",
	"--windsurf",
	"--vscode",
	"--amp",
	"--antigravity",
	"--deep-agents",
	"--gemini",
	"--kimi",
	"--opencode",
	"--warp",
	"--aider",
	"--goose",
	"--pi",
	"--crush",
];

const FIX_FLAGS = ["-d, --verbose", "-f, --force", "--safe", "-p, --prompt", ...FIX_AGENT_FLAGS];

const AGENT_FLAGS = [
	"--provider <provider>",
	"--target-score <score>",
	"--max-turns <n>",
	"--limit <n>",
	"--in-place",
	"--apply",
	"-y, --yes",
	"--dry-run",
	"--background",
	"--no-fix",
	"--commit",
	"--pr",
	"--branch <name>",
	"--base <branch>",
	"--commit-message <message>",
	"--title <title>",
	"--ready",
	"--no-keep-worktree",
	"--cleanup",
];

const AGENT_MONITOR_FLAGS = [
	"--provider <provider>",
	"--target-score <score>",
	"--max-turns <n>",
	"--limit <n>",
	"--in-place",
	"--dry-run",
	"--no-fix",
	"--repair",
	"--background",
	"--interval <ms>",
	"--debounce <ms>",
	"--once",
];

const CI_FLAGS = [
	"--changes",
	"--staged",
	"--base <ref>",
	"--human",
	"--sarif",
	"--format <format>",
];

const HOOK_INSTALL_FLAGS = [
	"--agent <names>",
	"-g, --global",
	"--project",
	"--dry-run",
	"--yes",
	"--quality-gate",
	"--claude",
	"--cursor",
	"--gemini",
	"--pi",
	"--codex",
	"--windsurf",
	"--cline",
	"--kilocode",
	"--antigravity",
	"--copilot",
];

const HOOK_UNINSTALL_FLAGS = [
	"--agent <names>",
	"-g, --global",
	"--project",
	"--dry-run",
	"--claude",
	"--cursor",
	"--gemini",
	"--pi",
	"--codex",
	"--windsurf",
	"--cline",
	"--kilocode",
	"--antigravity",
	"--copilot",
];

export const COMMAND_REFERENCE: CommandReference[] = [
	{
		command: "aislop [directory]",
		summary: "Open the interactive menu, or scan the current directory in non-TTY shells",
		flags: SCAN_FLAGS,
	},
	{
		command: "aislop scan [directory]",
		summary: "Score code quality and show findings",
		flags: SCAN_FLAGS,
	},
	{
		command: "aislop agent [directory]",
		summary: "Create a local worktree, stream a provider repair session, verify, and summarize",
		flags: AGENT_FLAGS,
	},
	{
		command: "aislop fix [directory]",
		summary: "Apply deterministic auto-fixes, or hand remaining findings to an agent",
		flags: FIX_FLAGS,
	},
	{
		command: "aislop agent plan [directory]",
		summary: "Preview provider, worktree, findings, and publish actions without editing",
		flags: AGENT_FLAGS,
	},
	{
		command: "aislop agent providers",
		summary: "Show installed local provider status and setup hints",
	},
	{
		command: "aislop agent connect [provider]",
		summary: "Run the selected provider's local CLI login flow",
		flags: ["--dry-run"],
	},
	{
		command: "aislop agent use [provider]",
		summary: "Set or show the repo-local default repair provider",
		flags: ["--root <directory>", "--dry-run"],
	},
	{
		command: "aislop agent switch [provider]",
		summary: "Alias for agent use",
		flags: ["--root <directory>", "--dry-run"],
	},
	{
		command: "aislop agent monitor [directory]",
		summary: "Watch git changes and stream scan or repair cycles",
		flags: AGENT_MONITOR_FLAGS,
	},
	{
		command: "aislop agent monitor list [directory]",
		summary: "List local background agent monitors",
		flags: ["--limit <n>"],
	},
	{
		command: "aislop agent monitor show [monitor]",
		summary: "Show a background agent monitor record",
		flags: ["--root <directory>"],
	},
	{
		command: "aislop agent monitor stop [monitor]",
		summary: "Stop a running background agent monitor",
		flags: ["--root <directory>", "--force"],
	},
	{
		command: "aislop agent sessions [directory]",
		summary: "List recent local agent sessions",
		flags: ["--limit <n>"],
	},
	{
		command: "aislop agent show [session]",
		summary: "Show a local agent session summary and timeline",
		flags: ["--root <directory>"],
	},
	{
		command: "aislop agent apply [session]",
		summary: "Apply a reviewed isolated worktree session back to the repo",
		flags: ["--root <directory>", "--dry-run", "-y, --yes"],
	},
	{
		command: "aislop agent watch [session]",
		summary: "Watch a local agent session as it streams",
		flags: ["--root <directory>", "--interval <ms>", "--once"],
	},
	{
		command: "aislop agent stop [session]",
		summary: "Stop a running background agent session",
		flags: ["--root <directory>", "--force"],
	},
	{
		command: "aislop ci [directory]",
		summary: "Run the CI quality gate with thresholded exit codes",
		flags: CI_FLAGS,
	},
	{
		command: "aislop init [directory]",
		summary: "Create config, rules, and optional GitHub Actions workflow",
		flags: ["--strict"],
	},
	{ command: "aislop doctor [directory]", summary: "Check installed engines and project coverage" },
	{
		command: "aislop rules [directory]",
		summary: "Explain rule IDs, severity, fixability, and meaning",
		flags: ["--search"],
	},
	{ command: "aislop hook", summary: "Manage per-edit coding-agent hooks" },
	{
		command: "aislop hook install [agents...]",
		summary: "Install coding-agent hooks",
		flags: HOOK_INSTALL_FLAGS,
	},
	{
		command: "aislop hook uninstall [agents...]",
		summary: "Remove installed coding-agent hooks",
		flags: HOOK_UNINSTALL_FLAGS,
	},
	{ command: "aislop hooks", summary: "Alias for hook" },
	{ command: "aislop hook status", summary: "Show installed hook status" },
	{ command: "aislop hook baseline", summary: "Capture the current score as the hook baseline" },
	{
		command: "aislop install [agents...]",
		summary: "Alias for hook install",
		flags: HOOK_INSTALL_FLAGS,
	},
	{
		command: "aislop install hooks [agents...]",
		summary: "Natural alias for install; same flags",
		flags: HOOK_INSTALL_FLAGS,
	},
	{
		command: "aislop uninstall [agents...]",
		summary: "Alias for hook uninstall",
		flags: HOOK_UNINSTALL_FLAGS,
	},
	{
		command: "aislop uninstall hooks [agents...]",
		summary: "Natural alias for uninstall; same flags",
		flags: HOOK_UNINSTALL_FLAGS,
	},
	{
		command: "aislop badge [directory]",
		summary: "Print score badge URL and README markdown",
		flags: ["--owner <owner>", "--repo <repo>", "--json"],
	},
	{
		command: "aislop trend [directory]",
		summary: "Show recent local scores from .aislop/history.jsonl",
		flags: ["--limit <n>"],
	},
	{ command: "aislop trends [directory]", summary: "Alias for trend", flags: ["--limit <n>"] },
	{ command: "aislop update", summary: "Show current and latest npm versions" },
	{ command: "aislop upgrade", summary: "Alias for update" },
	{ command: "aislop version", summary: "Print the installed version" },
	{ command: "aislop commands", summary: "Show this command reference" },
];

export const GUIDE_ROWS: DisplayRow[] = [
	{ label: "Use", value: "aislop commands is the full public command list with major flags." },
	{
		label: "Directory",
		value: "[directory] means a repo or path to scan; omit it for the current directory.",
	},
	{ label: "Help", value: "run aislop <command> --help for complete command-specific options." },
	{ label: "Aliases", value: "natural aliases are listed when they are public entry points." },
];

export const EXAMPLE_ROWS: DisplayRow[] = [
	{ label: "Scan", value: "aislop scan --changes" },
	{ label: "Fix", value: "aislop fix --safe" },
	{ label: "Agent", value: "aislop agent plan" },
	{ label: "Hooks", value: "aislop hook status" },
	{ label: "Trend", value: "aislop trends --limit 10" },
];

export const FLAG_GUIDE_ROWS: DisplayRow[] = [
	{ label: "--changes", value: "scan or gate files changed from HEAD or --base" },
	{ label: "--staged", value: "scan or gate staged files" },
	{ label: "--json", value: "emit machine-readable scan output" },
	{ label: "--sarif", value: "emit SARIF for code scanning" },
	{ label: "--safe", value: "only apply reversible fixes" },
	{ label: "--provider", value: "choose auto, codex, claude, or opencode for local agent runs" },
	{ label: "--dry-run", value: "preview the action without writing changes" },
];
