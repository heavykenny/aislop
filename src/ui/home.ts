import { APP_VERSION } from "../version.js";
import { highlightAislop } from "./brand.js";
import { renderHeader } from "./header.js";
import { terminalLink } from "./link.js";
import { renderHintLine } from "./logger.js";
import { style, theme } from "./theme.js";
import { padEnd } from "./width.js";

export { renderCommandReference } from "./command-reference.js";

interface HomeCommand {
	command: string;
	summary: string;
	group: "Run" | "Setup" | "Learn" | "Utility";
}

const HOME_COMMANDS: HomeCommand[] = [
	{ command: "aislop scan", summary: "Score this project and show findings", group: "Run" },
	{
		command: "aislop agent",
		summary: "Repair slop with your coding agent in an isolated worktree",
		group: "Run",
	},
	{
		command: "aislop fix",
		summary: "Auto-fix the mechanical issues deterministically",
		group: "Run",
	},
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
const COMMAND_PROMPT = ">";

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
				`   ${style(theme, "muted", COMMAND_PROMPT)} ${highlightAislop(padEnd(item.command, commandWidth), theme)}  ${highlightAislop(item.summary, theme, "muted")}`,
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
		"   aislop agent [options] [directory]",
		"   aislop fix [options] [directory]",
		"   aislop ci [options] [directory]",
		"   aislop init [options] [directory]",
		"   aislop doctor [directory]",
		"   aislop rules [directory]",
		"   aislop badge [options] [directory]",
		"   aislop trend [options] [directory]",
		"   aislop trends [options] [directory]",
		"   aislop hook [command]",
		"   aislop hook install [agents...]",
		"   aislop install hooks [agents...]",
		"   aislop update",
		"   aislop version",
		"",
		` ${style(theme, "dim", "Interactive")}`,
		"   > aislop                       open the menu",
		"   Scan                           Score this project and show findings",
		"   Agent                          Run a coding agent to repair slop",
		"   Fix                            Auto-fix the mechanical issues",
		"   Doctor                         Check installed engines and tools",
		"   Install hooks                  Run aislop after agent edits",
		"",
		` ${style(theme, "dim", "Scan flags")}`,
		"   --changes        scan changed files from HEAD",
		"   --staged         scan staged files",
		"   --base           diff base for --changes",
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
		` ${style(theme, "dim", "Agent flags")}`,
		"   --provider       choose auto, codex, claude, or opencode",
		"   --target-score   score to converge toward",
		"   --in-place       edit the current worktree",
		"   --apply          apply the accepted diff back",
		"   --background     start locally and return immediately",
		"   --commit         commit the verified diff",
		"   --pr             push and open a draft pull request",
		"",
		` ${style(theme, "dim", "Agent commands")}`,
		"   aislop agent plan             preview provider, worktree, findings, and publish actions",
		"   aislop agent providers        show local provider status",
		"   aislop agent connect          connect Codex, Claude Code, or OpenCode locally",
		"   aislop agent use              set the repo-local default provider",
		"   aislop agent switch           alias for agent use",
		"   aislop agent monitor          watch git changes and stream scan cycles",
		"   aislop agent monitor list     list background monitors",
		"   aislop agent monitor show     show a background monitor",
		"   aislop agent monitor stop     stop a background monitor",
		"   aislop agent sessions         list local session transcripts",
		"   aislop agent show             show a session timeline and summary",
		"   aislop agent apply            apply a reviewed worktree session",
		"   aislop agent watch            stream session transcript updates",
		"   aislop agent stop             stop a background session",
		"",
		` ${style(theme, "dim", "Hook commands")}`,
		"   aislop hook                   manage coding-agent hooks",
		"   aislop hook install           install coding-agent hooks",
		"   aislop hook uninstall         remove coding-agent hooks",
		"   aislop hook status            show installed hooks",
		"   aislop hook baseline          capture the current score baseline",
		"   aislop install hooks          natural alias for hook install",
		"   aislop uninstall hooks        natural alias for hook uninstall",
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
		"   aislop agent plan",
		"   aislop agent connect codex",
		"   aislop agent use codex",
		"   aislop agent monitor --once",
		"   aislop agent monitor --background",
		"   aislop agent monitor list",
		"   aislop agent --provider codex",
		"   aislop agent sessions",
		"   aislop agent show",
		"   aislop agent apply",
		"   aislop agent watch",
		"   aislop agent stop",
		"   aislop agent --provider claude --pr",
		"   aislop hook install --claude",
		"   aislop install hooks",
		"   aislop rules --search",
		"   aislop trends --limit 10",
		"",
	]
		.map((line) => highlightAislop(line, theme))
		.join("\n");

export const renderHome = (input: HomeRenderInput = {}): string => {
	const version = input.version ?? APP_VERSION;
	let out = renderHeader({ version, command: "--bare", context: [] });
	out += `${renderCommandGroups().trimEnd()}\n`;
	out += `\n ${style(theme, "dim", "Team platform")}\n   ${style(theme, "muted", "Gate every PR and share one standard across your team")}  ${style(theme, "accent", terminalLink("https://scanaislop.com"))}\n`;
	if (input.includeHelpDetails) {
		out += `\n${renderHelpDetails().trimEnd()}\n`;
		out += renderHintLine("Run aislop scan to scan your project");
	}
	return out;
};

export const renderRootHelp = (input: { version?: string } = {}): string =>
	`${renderHome({ version: input.version, includeHelpDetails: true })}\n`;
