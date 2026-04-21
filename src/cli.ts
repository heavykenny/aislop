import { Command } from "commander";
import { ciCommand } from "./commands/ci.js";
import { doctorCommand } from "./commands/doctor.js";
import { fixCommand } from "./commands/fix.js";
import {
	defaultInstallTargets,
	hookBaseline,
	hookInstall,
	hookRun,
	hookStatus,
	hookUninstall,
	parseAgentFlag,
} from "./commands/hook.js";
import { initCommand } from "./commands/init.js";
import { interactiveCommand } from "./commands/interactive.js";
import { rulesCommand } from "./commands/rules.js";
import { scanCommand } from "./commands/scan.js";
import { loadConfig } from "./config/index.js";
import { renderHeader } from "./ui/header.js";
import { renderHintLine } from "./ui/logger.js";
import { style, theme } from "./ui/theme.js";
import { flushTelemetry } from "./utils/telemetry.js";
import { APP_VERSION } from "./version.js";

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

const program = new Command()
	.name("aislop")
	.description("The unified code quality CLI")
	.version(APP_VERSION, "-v, --version")
	.argument("[directory]", "project directory to scan", ".")
	.option("--changes", "only scan changed files (git diff)")
	.option("--staged", "only scan staged files")
	.option("-d, --verbose", "show file details per rule")
	.option("--json", "output JSON instead of terminal UI")
	.option(
		"--exclude <patterns>",
		"comma-separated or repeatable list of paths and files to exclude",
		(value, previous: string[] = []) => {
			const parts = value
				.split(",")
				.map((v) => v.trim())
				.filter(Boolean);
			return [...previous, ...parts];
		},
		[],
	)
	.action(
		async (
			directory: string,
			flags: {
				changes?: boolean;
				staged?: boolean;
				verbose?: boolean;
				json?: boolean;
				exclude?: string[];
			},
		) => {
			const config = loadConfig(directory);
			const finalConfig = flags.exclude?.length
				? {
					...config,
					exclude: [...(config.exclude ?? []), ...flags.exclude],
				}
				: config;

			// If no flags, show interactive menu (if TTY)
			if (
				!flags.changes &&
				!flags.staged &&
				!flags.verbose &&
				!flags.json &&
				process.stdin.isTTY &&
				!(flags.exclude && flags.exclude.length > 0)
			) {
				try {
					await interactiveCommand(directory, finalConfig);
					return;
				} catch {
					// Fall through to scan if interactive fails
				}
			}

			const {exitCode} = await scanCommand(directory, finalConfig, {
				changes: Boolean(flags.changes),
				staged: Boolean(flags.staged),
				verbose: Boolean(flags.verbose),
				json: Boolean(flags.json),
				exclude: flags.exclude,
			});

			if (exitCode !== 0) {
				await flushTelemetry();
				process.exit(exitCode);
			}
		},
	)
	.addHelpText("beforeAll", renderHeader({version: APP_VERSION, command: "--bare", context: []}))
	.addHelpText(
		"after",
		`
${style(theme, "dim", "Commands:")}
  npx aislop scan [dir]      Full code quality scan
  npx aislop fix [dir]       Auto-fix ai slop in codebase
  npx aislop init [dir]      Initialize aislop config
  npx aislop doctor [dir]    Check installed tools
  npx aislop ci [dir]        CI-friendly JSON output
  npx aislop rules [dir]     List all rules

${style(theme, "dim", "Examples:")}
  npx aislop                 Interactive menu
  npx aislop scan            Scan entire project
  npx aislop scan -d         Scan with file/line details
  npx aislop scan --changes  Scan only changed files
  npx aislop scan --staged   Scan only staged files (for hooks)
  npx aislop fix             Auto-fix ai slop in codebase
  npx aislop fix -f          Run aggressive fixes (includes audit and dependency alignment)
  npx aislop fix --claude    Open Claude Code to fix remaining issues
  npx aislop fix --cursor    Open Cursor + copy prompt to clipboard
  npx aislop fix -p          Print a prompt to paste into any coding agent
  npx aislop ci              JSON output for CI pipelines
  npx aislop scan --exclude node_modules
  npx aislop scan --exclude node_modules,dist,file.txt
  npx aislop scan --exclude node_modules --exclude dist --exclude **/*.ts
${renderHintLine("Run npx aislop scan to scan your project").trimEnd()}
`,
	);

// Subcommands
program
	.command("scan [directory]")
	.description("Run full code quality scan")
	.option("--changes", "only scan changed files")
	.option("--staged", "only scan staged files")
	.option("-d, --verbose", "show file details per rule")
	.option("--json", "output JSON")
	.option(
		"--exclude <patterns>",
		"comma-separated or repeatable list of paths and files to exclude",
		(value, previous: string[] = []) => {
			const parts = value
				.split(",")
				.map((v) => v.trim())
				.filter(Boolean);
			return [...previous, ...parts];
		},
		[],
	)
	.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as {
			changes?: boolean;
			staged?: boolean;
			verbose?: boolean;
			json?: boolean;
			exclude?: string[];
		};
		const config = loadConfig(directory);
		const finalConfig = flags.exclude?.length
			? {
				...config,
				exclude: [...(config.exclude ?? []), ...flags.exclude],
			}
			: config;

		const {exitCode} = await scanCommand(directory, finalConfig, {
			changes: Boolean(flags.changes),
			staged: Boolean(flags.staged),
			verbose: Boolean(flags.verbose),
			json: Boolean(flags.json),
			exclude: flags.exclude ?? [],
		});
		if (exitCode !== 0) {
			await flushTelemetry();
			process.exit(exitCode);
		}
	});

program
	.command("fix [directory]")
	.description("Auto-fix ai slop in codebase")
	.option("-d, --verbose", "show detailed fix progress")
	.option("-f, --force", "run aggressive fixes (audit and framework dependency alignment)")
	.option("-p, --prompt", "print a prompt for your coding agent to fix remaining issues")
	.option("--claude", "open Claude Code to fix remaining issues")
	.option("--codex", "open Codex to fix remaining issues")
	.option("--cursor", "open Cursor and copy prompt to clipboard")
	.option("--windsurf", "open Windsurf and copy prompt to clipboard")
	.option("--vscode", "open VS Code and copy prompt to clipboard")
	.option("--amp", "open Amp to fix remaining issues")
	.option("--antigravity", "open Antigravity to fix remaining issues")
	.option("--deep-agents", "open Deep Agents to fix remaining issues")
	.option("--gemini", "open Gemini CLI to fix remaining issues")
	.option("--kimi", "open Kimi Code CLI to fix remaining issues")
	.option("--opencode", "open OpenCode to fix remaining issues")
	.option("--warp", "open Warp to fix remaining issues")
	.option("--aider", "open Aider to fix remaining issues")
	.option("--goose", "open Goose to fix remaining issues")
	.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as Record<string, boolean | undefined>;
		const config = loadConfig(directory);
		const agentNames = [
			"claude",
			"codex",
			"cursor",
			"windsurf",
			"vscode",
			"amp",
			"antigravity",
			"deepAgents",
			"gemini",
			"kimi",
			"opencode",
			"warp",
			"aider",
			"goose",
		] as const;
		// Commander camelCases --deep-agents to deepAgents
		const flagToAgent: Record<string, string> = {deepAgents: "deep-agents"};
		const matched = agentNames.find((name) => flags[name]);
		const agent = matched ? (flagToAgent[matched] ?? matched) : undefined;
		await fixCommand(directory, config, {
			verbose: Boolean(flags.verbose),
			force: Boolean(flags.force),
			prompt: Boolean(flags.prompt),
			agent,
		});
	});

program
	.command("init [directory]")
	.description("Initialize aislop config in project")
	.action(async (directory = ".") => {
		await initCommand(directory);
	});

program
	.command("doctor [directory]")
	.description("Check installed tools and environment")
	.action(async (directory = ".") => {
		await doctorCommand(directory);
	});

program
	.command("ci [directory]")
	.description("CI-friendly JSON output with exit codes")
	.option("--human", "render the human-friendly scan design instead of JSON")
	.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as { human?: boolean };
		const config = loadConfig(directory);
		const {exitCode} = await ciCommand(directory, config, {
			human: Boolean(flags.human),
		});
		if (exitCode !== 0) {
			await flushTelemetry();
			process.exit(exitCode);
		}
	});

program
	.command("rules [directory]")
	.description("List all available rules")
	.action(async (directory = ".") => {
		await rulesCommand(directory);
	});

const hook = program.command("hook").description("Install or invoke AI-agent integration hooks");

const resolveScope = (flags: { global?: boolean; project?: boolean }): "global" | "project" => {
	if (flags.project) return "project";
	if (flags.global) return "global";
	return "global";
};

hook
	.command("install")
	.description("Install aislop hooks for one or more coding agents")
	.option(
		"--agent <names>",
		"comma-separated agent list (claude,cursor,gemini,codex,windsurf,cline,kilocode,antigravity,copilot). default: all non-project-only agents",
	)
	.option("-g, --global", "install to the user-scope config (default for agents that support it)")
	.option("--project", "install to the project-scope config")
	.option("--dry-run", "print the planned diff without writing")
	.option("--yes", "skip the confirmation prompt (reserved)")
	.option(
		"--quality-gate",
		"add a Stop hook that blocks when score regresses below baseline (Claude only)",
	)
	.action(
		async (opts: {
			agent?: string;
			global?: boolean;
			project?: boolean;
			dryRun?: boolean;
			yes?: boolean;
			qualityGate?: boolean;
		}) => {
			const agents = parseAgentFlag(opts.agent, defaultInstallTargets());
			await hookInstall({
				agents,
				scope: resolveScope(opts),
				dryRun: Boolean(opts.dryRun),
				yes: Boolean(opts.yes),
				qualityGate: Boolean(opts.qualityGate),
			});
		},
	);

hook
	.command("uninstall")
	.description("Uninstall aislop hooks for one or more agents")
	.option("--agent <names>", "comma-separated agent list. default: all agents with installed hooks")
	.option("-g, --global", "uninstall from user-scope config")
	.option("--project", "uninstall from project-scope config")
	.option("--dry-run", "print the planned removal without writing")
	.action(
		async (opts: { agent?: string; global?: boolean; project?: boolean; dryRun?: boolean }) => {
			const agents = parseAgentFlag(opts.agent, defaultInstallTargets());
			await hookUninstall({
				agents,
				scope: resolveScope(opts),
				dryRun: Boolean(opts.dryRun),
				yes: true,
				qualityGate: false,
			});
		},
	);

hook
	.command("status")
	.description("Show which agent hooks are installed")
	.action(async () => {
		await hookStatus();
	});

hook
	.command("baseline")
	.description("Capture the current project score as the quality-gate baseline")
	.action(async () => {
		await hookBaseline();
	});

hook
	.command("claude")
	.description("Internal: Claude Code PostToolUse / Stop callback (reads stdin)")
	.option("--stop", "run in Stop-hook mode for the quality gate")
	.action(async (opts: { stop?: boolean }) => {
		await hookRun("claude", { stop: Boolean(opts.stop) });
	});

hook
	.command("cursor")
	.description("Internal: Cursor afterFileEdit callback (reads stdin)")
	.action(async () => {
		await hookRun("cursor");
	});

hook
	.command("gemini")
	.description("Internal: Gemini CLI AfterTool callback (reads stdin)")
	.action(async () => {
		await hookRun("gemini");
	});

const main = async () => {
	await program.parseAsync();
	await flushTelemetry();
};

main();
