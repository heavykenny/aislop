import { APP_VERSION } from "../version.js";
import { renderHeader } from "./header.js";
import { renderHintLine } from "./logger.js";
import { style, theme } from "./theme.js";
import { padEnd } from "./width.js";

interface HomeCommand {
	command: string;
	summary: string;
	group: "Run" | "Setup" | "Learn" | "Utility";
}

const HOME_COMMANDS: HomeCommand[] = [
	{ command: "aislop scan", summary: "Score this project and show findings", group: "Run" },
	{ command: "aislop fix", summary: "Auto-fix safe issues or hand off to an agent", group: "Run" },
	{ command: "aislop ci", summary: "Run the quality gate for CI", group: "Run" },
	{ command: "aislop doctor", summary: "Check which engines can run here", group: "Run" },
	{ command: "aislop init", summary: "Create config and optional CI workflow", group: "Setup" },
	{
		command: "aislop hook install",
		summary: "Run aislop after coding-agent edits",
		group: "Setup",
	},
	{ command: "aislop rules", summary: "Explain every rule and fix mode", group: "Learn" },
	{ command: "aislop trend", summary: "Show local score history", group: "Learn" },
	{
		command: "aislop badge",
		summary: "Print a score badge URL and README markdown",
		group: "Learn",
	},
	{ command: "aislop commands", summary: "List all commands and major flags", group: "Utility" },
	{ command: "aislop update", summary: "Check the latest npm version", group: "Learn" },
	{ command: "aislop version", summary: "Print the installed version", group: "Utility" },
];

const GROUPS: HomeCommand["group"][] = ["Run", "Setup", "Learn", "Utility"];

interface CommandReference {
	command: string;
	summary: string;
	flags?: string[];
}

const COMMAND_REFERENCE: CommandReference[] = [
	{
		command: "aislop",
		summary: "Open the interactive menu, or scan the current directory in non-TTY shells",
	},
	{
		command: "aislop scan [directory]",
		summary: "Score code quality and show findings",
		flags: [
			"--changes",
			"--staged",
			"-d, --verbose",
			"--json",
			"--sarif",
			"--format <format>",
			"--include <patterns>",
			"--exclude <patterns>",
		],
	},
	{
		command: "aislop fix [directory]",
		summary: "Apply safe auto-fixes or hand remaining findings to an agent",
		flags: [
			"-d, --verbose",
			"-f, --force",
			"--safe",
			"-p, --prompt",
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
		],
	},
	{
		command: "aislop ci [directory]",
		summary: "Run the CI quality gate with thresholded exit codes",
		flags: ["--human", "--sarif", "--format <format>"],
	},
	{
		command: "aislop init [directory]",
		summary: "Create .aislop/config.yml, .aislop/rules.yml, and optional GitHub Actions workflow",
		flags: ["--strict"],
	},
	{ command: "aislop doctor [directory]", summary: "Check installed engines and project coverage" },
	{
		command: "aislop rules [directory]",
		summary: "Explain rule IDs, severity, fixability, and meaning",
		flags: ["--search"],
	},
	{
		command: "aislop hook install [agents...]",
		summary: "Install coding-agent hooks",
		flags: [
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
		],
	},
	{
		command: "aislop hook uninstall [agents...]",
		summary: "Remove installed coding-agent hooks",
		flags: [
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
		],
	},
	{ command: "aislop hooks", summary: "Alias for hook" },
	{ command: "aislop hook status", summary: "Show installed hook status" },
	{ command: "aislop hook baseline", summary: "Capture the current score as the hook baseline" },
	{
		command: "aislop install [agents...]",
		summary: "Alias for hook install",
		flags: [
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
		],
	},
	{
		command: "aislop install hooks [agents...]",
		summary: "Natural alias for install; same flags",
	},
	{
		command: "aislop uninstall [agents...]",
		summary: "Alias for hook uninstall",
		flags: [
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
		],
	},
	{
		command: "aislop uninstall hooks [agents...]",
		summary: "Natural alias for uninstall; same flags",
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
	{ command: "aislop update", summary: "Show current and latest npm versions" },
	{ command: "aislop upgrade", summary: "Alias for update" },
	{ command: "aislop version", summary: "Print the installed version" },
	{ command: "aislop commands", summary: "Show this command reference" },
];

interface HomeRenderInput {
	version?: string;
	includeHelpDetails?: boolean;
}

const renderCommandGroups = (): string => {
	const commandWidth = Math.max(...HOME_COMMANDS.map((c) => c.command.length));
	const lines: string[] = [];
	for (const group of GROUPS) {
		lines.push(` ${style(theme, "dim", group)}`);
		for (const item of HOME_COMMANDS.filter((c) => c.group === group)) {
			lines.push(
				`   ${style(theme, "muted", "$")} ${style(theme, "fg", padEnd(item.command, commandWidth))}  ${style(theme, "muted", item.summary)}`,
			);
		}
		lines.push("");
	}
	return lines.join("\n");
};

const renderHelpDetails = (): string =>
	[
		` ${style(theme, "dim", "Usage")}`,
		"   aislop                         Open interactive menu",
		"   aislop scan [options] [directory]",
		"   aislop fix [options] [directory]",
		"   aislop ci [options] [directory]",
		"   aislop init [options] [directory]",
		"   aislop doctor [directory]",
		"   aislop rules [directory]",
		"   aislop badge [options] [directory]",
		"   aislop trend [options] [directory]",
		"   aislop hook install [agents...]",
		"   aislop install hooks [agents...]",
		"   aislop update",
		"   aislop version",
		"",
		` ${style(theme, "dim", "Scan flags")}`,
		"   --changes        scan changed files from HEAD",
		"   --staged         scan staged files",
		"   --json           emit machine-readable JSON",
		"   --sarif          emit SARIF 2.1.0",
		"   --format         choose json or sarif",
		"   --exclude        exclude comma-separated or repeated paths",
		"   --include        include comma-separated or repeated paths",
		"",
		` ${style(theme, "dim", "Fix flags")}`,
		"   --safe           only reversible fixes",
		"   --force          aggressive dependency and framework fixes",
		"   --prompt         print an agent handoff prompt",
		"   --codex          open Codex to fix remaining findings",
		"   --claude         open Claude Code to fix remaining findings",
		"",
		` ${style(theme, "dim", "Ignore and scope")}`,
		"   .aislopignore    skip generated, vendored, or noisy paths",
		"   .gitignore       respected for untracked files",
		"   --exclude        skip extra paths for this run",
		"   --include        scan only matching paths for this run",
		"",
		` ${style(theme, "dim", "More")}`,
		"   aislop commands        show every command and major flag",
		"   aislop <cmd> --help    show detailed help for one command",
		"   -h, --help             show help",
		"   -v, -V, --version      show version",
		"",
		` ${style(theme, "dim", "One-off latest run")}`,
		"   npx aislop@latest scan",
		"",
		` ${style(theme, "dim", "Examples")}`,
		"   aislop scan --changes",
		"   aislop fix --codex",
		"   aislop hook install --claude",
		"   aislop install hooks",
		"   aislop rules --search",
		"",
	].join("\n");

export const renderHome = (input: HomeRenderInput = {}): string => {
	const version = input.version ?? APP_VERSION;
	let out = renderHeader({ version, command: "--bare", context: [] });
	out += `${renderCommandGroups().trimEnd()}\n`;
	if (input.includeHelpDetails) {
		out += `\n${renderHelpDetails().trimEnd()}\n`;
		out += renderHintLine("Run aislop scan to scan your project");
	}
	return out;
};

export const renderRootHelp = (input: { version?: string } = {}): string =>
	`${renderHome({ version: input.version, includeHelpDetails: true })}\n`;

export const renderCommandReference = (input: { version?: string } = {}): string => {
	const version = input.version ?? APP_VERSION;
	const commandWidth = Math.max(...COMMAND_REFERENCE.map((c) => c.command.length));
	const lines = [
		renderHeader({ version, command: "Commands", context: ["full list"] }).trimEnd(),
		"",
	];

	for (const item of COMMAND_REFERENCE) {
		lines.push(
			` ${style(theme, "fg", padEnd(item.command, commandWidth))}  ${style(theme, "muted", item.summary)}`,
		);
		if (item.flags?.length) lines.push(`   ${style(theme, "dim", item.flags.join("  "))}`);
	}

	lines.push(
		"",
		` ${style(theme, "dim", "Scope files")}`,
		" .aislopignore  Skip generated, vendored, or noisy paths",
		" .gitignore     Respected for untracked files",
	);
	lines.push(
		"",
		renderHintLine("Run aislop <command> --help for complete command-specific options").trimEnd(),
	);
	return `${lines.join("\n")}\n`;
};
