import { Command } from "commander";
import { registerHookCommand } from "./cli/hook-command.js";
import { badgeCommand } from "./commands/badge.js";
import { ciCommand } from "./commands/ci.js";
import { doctorCommand } from "./commands/doctor.js";
import { fixCommand } from "./commands/fix.js";
import { initCommand } from "./commands/init.js";
import { interactiveCommand } from "./commands/interactive.js";
import { rulesCommand } from "./commands/rules.js";
import { scanCommand } from "./commands/scan.js";
import { trendCommand } from "./commands/trend.js";
import { loadConfig } from "./config/index.js";
import {
	ensureInstallId,
	flushTelemetry,
	isTelemetryDisabled,
	resolveInstallIdPath,
	track,
	withCommandLifecycle,
} from "./telemetry/index.js";
import { renderHeader } from "./ui/header.js";
import { renderHintLine } from "./ui/logger.js";
import { style, theme } from "./ui/theme.js";
import { APP_VERSION } from "./version.js";

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

const fireInstalledOnce = (): void => {
	if (isTelemetryDisabled(loadConfig(process.cwd()).telemetry)) return;
	const ensured = ensureInstallId(resolveInstallIdPath());
	if (ensured.created) {
		track({ event: "cli_installed", config: loadConfig(process.cwd()).telemetry });
	}
};

interface ScanFlags {
	changes?: boolean;
	staged?: boolean;
	verbose?: boolean;
	json?: boolean;
	sarif?: boolean;
	format?: string;
	exclude?: string[];
	include?: string[];
}

const commaSeparatedParser = (value: string, previous: string[] = []): string[] => {
	const parts = value
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
	return [...previous, ...parts];
};

const wantsSarif = (flags: ScanFlags): boolean => Boolean(flags.sarif) || flags.format === "sarif";

const wantsJson = (flags: ScanFlags): boolean => Boolean(flags.json) || flags.format === "json";

const runScan = async (directory: string, flags: ScanFlags): Promise<void> => {
	const config = loadConfig(directory);
	const finalConfig = {
		...config,
		exclude: [...(config.exclude ?? []), ...(flags.exclude ?? [])],
		include: [...(config.include ?? []), ...(flags.include ?? [])],
	};
	const sarif = wantsSarif(flags);
	const { exitCode } = await scanCommand(directory, finalConfig, {
		changes: Boolean(flags.changes),
		staged: Boolean(flags.staged),
		verbose: Boolean(flags.verbose),
		json: !sarif && wantsJson(flags),
		sarif,
		exclude: flags.exclude,
		include: flags.include,
	});
	if (exitCode !== 0) {
		await flushTelemetry();
		process.exitCode = exitCode;
	}
};

const noFlagsPassed = (flags: ScanFlags): boolean =>
	!flags.changes &&
	!flags.staged &&
	!flags.verbose &&
	!flags.json &&
	!flags.sarif &&
	!flags.format &&
	!(flags.exclude && flags.exclude.length > 0) &&
	!(flags.include && flags.include.length > 0);

const program = new Command()
	.name("aislop")
	.description("The unified code quality CLI")
	.version(APP_VERSION, "-v, --version")
	.argument("[directory]", "project directory to scan", ".")
	.option("--changes", "only scan changed files (git diff)")
	.option("--staged", "only scan staged files")
	.option("-d, --verbose", "show file details per rule")
	.option("--json", "output JSON instead of terminal UI")
	.option("--sarif", "output SARIF 2.1.0 (for GitHub code scanning)")
	.option("--format <format>", "output format: json or sarif")
	.option(
		"--exclude <patterns>",
		"comma-separated or repeatable list of paths and files to exclude",
		commaSeparatedParser,
		[],
	)
	.option(
		"--include <patterns>",
		"comma-separated or repeatable list of paths and files to include",
		commaSeparatedParser,
		[],
	)
	.action(async (directory: string, flags: ScanFlags) => {
		if (noFlagsPassed(flags) && process.stdin.isTTY) {
			try {
				await interactiveCommand(directory, loadConfig(directory));
				return;
			} catch {
				// Interactive prompt was cancelled or errored; fall through to a plain scan.
			}
		}
		await runScan(directory, flags);
	})
	.addHelpText("beforeAll", renderHeader({ version: APP_VERSION, command: "--bare", context: [] }))
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
  npx aislop trend [dir]     Show score history trend

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
  npx aislop scan --sarif    SARIF 2.1.0 for GitHub code scanning
  npx aislop trend           Show score history over time
  npx aislop scan --exclude node_modules
  npx aislop scan --exclude node_modules,dist,file.txt
  npx aislop scan --exclude node_modules --exclude dist --exclude **/*.ts
${renderHintLine("Run npx aislop scan to scan your project").trimEnd()}
`,
	);

program
	.command("scan [directory]")
	.description("Run full code quality scan")
	.option("--changes", "only scan changed files")
	.option("--staged", "only scan staged files")
	.option("-d, --verbose", "show file details per rule")
	.option("--json", "output JSON")
	.option("--sarif", "output SARIF 2.1.0 (for GitHub code scanning)")
	.option("--format <format>", "output format: json or sarif")
	.option(
		"--exclude <patterns>",
		"comma-separated or repeatable list of paths and files to exclude",
		commaSeparatedParser,
		[],
	)
	.option(
		"--include <patterns>",
		"comma-separated or repeatable list of paths and files to include",
		commaSeparatedParser,
		[],
	)
	.action(async (directory = ".", _flags, command) => {
		await runScan(directory, command.optsWithGlobals() as ScanFlags);
	});

const FIX_AGENT_FLAGS: { flag: string; name: string; help: string }[] = [
	{ flag: "claude", name: "claude", help: "open Claude Code to fix remaining issues" },
	{ flag: "codex", name: "codex", help: "open Codex to fix remaining issues" },
	{ flag: "cursor", name: "cursor", help: "open Cursor and copy prompt to clipboard" },
	{ flag: "windsurf", name: "windsurf", help: "open Windsurf and copy prompt to clipboard" },
	{ flag: "vscode", name: "vscode", help: "open VS Code and copy prompt to clipboard" },
	{ flag: "amp", name: "amp", help: "open Amp to fix remaining issues" },
	{ flag: "antigravity", name: "antigravity", help: "open Antigravity to fix remaining issues" },
	// Commander camelCases --deep-agents to deepAgents on the parsed opts object.
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

const matchFixAgent = (flags: Record<string, boolean | undefined>): string | undefined => {
	const hit = FIX_AGENT_FLAGS.find((a) => flags[a.name]);
	return hit?.flag;
};

const fixProgram = program
	.command("fix [directory]")
	.description("Auto-fix ai slop in codebase")
	.option("-d, --verbose", "show detailed fix progress")
	.option("-f, --force", "run aggressive fixes (audit and framework dependency alignment)")
	.option("-p, --prompt", "print a prompt for your coding agent to fix remaining issues");

for (const a of FIX_AGENT_FLAGS) fixProgram.option(`--${a.flag}`, a.help);

fixProgram.action(async (directory = ".", _flags, command) => {
	const flags = command.optsWithGlobals() as Record<string, boolean | undefined>;
	await fixCommand(directory, loadConfig(directory), {
		verbose: Boolean(flags.verbose),
		force: Boolean(flags.force),
		prompt: Boolean(flags.prompt),
		agent: matchFixAgent(flags),
	});
});

program
	.command("init [directory]")
	.description("Initialize aislop config in project")
	.option(
		"--strict",
		"write an enterprise-grade default config: all engines, typecheck on, CI failBelow 85, workflow included",
	)
	.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as { strict?: boolean };
		await withCommandLifecycle(
			{ command: "init", config: loadConfig(directory).telemetry },
			async () => {
				await initCommand(directory, { strict: Boolean(flags.strict) });
				return { exitCode: 0 };
			},
		);
	});

program
	.command("doctor [directory]")
	.description("Check installed tools and environment")
	.action(async (directory = ".") => {
		await withCommandLifecycle(
			{ command: "doctor", config: loadConfig(directory).telemetry },
			async () => {
				await doctorCommand(directory);
				return { exitCode: 0 };
			},
		);
	});

program
	.command("ci [directory]")
	.description("CI-friendly JSON output with exit codes")
	.option("--human", "render the human-friendly scan design instead of JSON")
	.option("--sarif", "output SARIF 2.1.0 (for GitHub code scanning)")
	.option("--format <format>", "output format: json or sarif")
	.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as {
			human?: boolean;
			sarif?: boolean;
			format?: string;
		};
		const config = loadConfig(directory);
		const { exitCode } = await ciCommand(directory, config, {
			human: Boolean(flags.human),
			sarif: Boolean(flags.sarif) || flags.format === "sarif",
		});
		if (exitCode !== 0) {
			await flushTelemetry();
			process.exitCode = exitCode;
		}
	});

program
	.command("rules [directory]")
	.description("List all available rules")
	.action(async (directory = ".") => {
		await withCommandLifecycle(
			{ command: "rules", config: loadConfig(directory).telemetry },
			async () => {
				await rulesCommand(directory);
				return { exitCode: 0 };
			},
		);
	});

program
	.command("badge [directory]")
	.description("Print the public score badge URL + README markdown for this repo")
	.option("--owner <owner>", "GitHub owner (auto-detected from git remote if omitted)")
	.option("--repo <repo>", "GitHub repo name (auto-detected from git remote if omitted)")
	.option("--json", "emit machine-readable JSON instead of the rendered output")
	.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as {
			owner?: string;
			repo?: string;
			json?: boolean;
		};
		try {
			await withCommandLifecycle(
				{ command: "badge", config: loadConfig(directory).telemetry },
				async () => {
					await badgeCommand({
						directory,
						owner: flags.owner,
						repo: flags.repo,
						json: Boolean(flags.json),
					});
					return { exitCode: 0 };
				},
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Failed to print badge";
			process.stderr.write(`${message}\n`);
			process.exit(1);
		}
	});

program
	.command("trend [directory]")
	.description("Show score history trend from .aislop/history.jsonl")
	.option("--limit <n>", "number of recent runs to show", (v) => Number.parseInt(v, 10))
	.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as { limit?: number };
		await withCommandLifecycle(
			{ command: "trend", config: loadConfig(directory).telemetry },
			async () => {
				trendCommand(directory, flags.limit);
				return { exitCode: 0 };
			},
		);
	});

registerHookCommand(program);

const main = async () => {
	fireInstalledOnce();
	await program.parseAsync();
	await flushTelemetry();
};

main();
