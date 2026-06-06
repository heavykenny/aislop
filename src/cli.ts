import { Command } from "commander";
import { registerHookAliases, registerHookCommand } from "./cli/hook-command.js";
import { badgeCommand } from "./commands/badge.js";
import { ciCommand } from "./commands/ci.js";
import { doctorCommand } from "./commands/doctor.js";
import { fixCommand } from "./commands/fix.js";
import { initCommand } from "./commands/init.js";
import { interactiveCommand } from "./commands/interactive.js";
import { rulesCommand } from "./commands/rules.js";
import { scanCommand } from "./commands/scan.js";
import { trendCommand } from "./commands/trend.js";
import { updateCommand } from "./commands/update.js";
import { loadConfig } from "./config/index.js";
import {
	ensureInstallId,
	flushTelemetry,
	isTelemetryDisabled,
	resolveInstallIdPath,
	track,
	withCommandLifecycle,
} from "./telemetry/index.js";
import { renderCommandReference, renderRootHelp } from "./ui/home.js";
import { maybeNotifyUpdate } from "./update-notifier.js";
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
	base?: string;
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
		base: flags.base,
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

const hasNoUserArgs = (): boolean => process.argv.slice(2).length === 0;

const shouldRenderRootHelp = (): boolean => {
	const args = process.argv.slice(2);
	return args.length === 1 && ["--help", "-h", "help"].includes(args[0] ?? "");
};

const shouldRenderPlainVersion = (): boolean => {
	const args = process.argv.slice(2);
	return args.length === 1 && ["-V", "-v", "--version", "version"].includes(args[0] ?? "");
};

const program = new Command()
	.name("aislop")
	.description("The quality gate for agentic coding.")
	.version(APP_VERSION, "-v, --version")
	.argument("[directory]", "directory to scan when no command is passed", ".")
	.option("--changes", "only scan changed files (git diff)")
	.option("--staged", "only scan staged files")
	.option("--base <ref>", "diff base for --changes, e.g. origin/main (default HEAD)")
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
		if (hasNoUserArgs() && noFlagsPassed(flags) && process.stdin.isTTY) {
			try {
				await interactiveCommand(directory, loadConfig(directory));
				return;
			} catch {
				// Interactive prompt was cancelled or errored; fall through to a plain scan.
			}
		}
		await runScan(directory, flags);
	});

program
	.command("scan [directory]")
	.description("Score a project and print findings")
	.option("--changes", "only scan changed files")
	.option("--staged", "only scan staged files")
	.option("--base <ref>", "diff base for --changes, e.g. origin/main (default HEAD)")
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
	.description("Auto-fix findings or hand off to a coding agent")
	.option("-d, --verbose", "show detailed fix progress")
	.option("-f, --force", "run aggressive fixes (audit and framework dependency alignment)")
	.option(
		"--safe",
		"only apply reversible fixes (imports, comment removal, formatting); skip anything that deletes code or rewrites behaviour",
	)
	.option("-p, --prompt", "print a prompt for your coding agent to fix remaining issues");

for (const a of FIX_AGENT_FLAGS) fixProgram.option(`--${a.flag}`, a.help);

fixProgram.action(async (directory = ".", _flags, command) => {
	const flags = command.optsWithGlobals() as Record<string, boolean | undefined>;
	await fixCommand(directory, loadConfig(directory), {
		verbose: Boolean(flags.verbose),
		force: Boolean(flags.force),
		safe: Boolean(flags.safe),
		prompt: Boolean(flags.prompt),
		agent: matchFixAgent(flags),
	});
});

program
	.command("init [directory]")
	.description("Create aislop config and optional CI workflow")
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
	.description("Check toolchain coverage for this project")
	.action(async (directory = ".") => {
		await withCommandLifecycle(
			{ command: "doctor", config: loadConfig(directory).telemetry },
			async () => {
				await doctorCommand(directory);
				return { exitCode: 0 };
			},
		);
	});

const ciProgram = program.command("ci [directory]").description("Run the quality gate for CI");

const CI_OPTIONS: [flag: string, description: string][] = [
	["--changes", "only gate files changed vs --base (or HEAD)"],
	["--staged", "only gate staged files"],
	["--base <ref>", "diff base for --changes, e.g. origin/main (default HEAD)"],
	["--human", "render the human-friendly scan design instead of JSON"],
	["--sarif", "output SARIF 2.1.0 (for GitHub code scanning)"],
	["--format <format>", "output format: json or sarif"],
];
for (const [flag, description] of CI_OPTIONS) ciProgram.option(flag, description);

ciProgram.action(async (directory = ".", _flags, command) => {
	const flags = command.optsWithGlobals() as {
		changes?: boolean;
		staged?: boolean;
		base?: string;
		human?: boolean;
		sarif?: boolean;
		format?: string;
	};
	const config = loadConfig(directory);
	const { exitCode } = await ciCommand(directory, config, {
		changes: Boolean(flags.changes),
		staged: Boolean(flags.staged),
		base: flags.base,
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
	.description("Explain rules, severity, and fix mode")
	.option("-s, --search", "open an interactive searchable rule explorer")
	.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as { search?: boolean };
		await withCommandLifecycle(
			{ command: "rules", config: loadConfig(directory).telemetry },
			async () => {
				await rulesCommand(directory, { interactive: Boolean(flags.search) });
				return { exitCode: 0 };
			},
		);
	});

program
	.command("badge [directory]")
	.description("Print score badge URL and README markdown")
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
	.description("Show local score history")
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

program
	.command("update")
	.alias("upgrade")
	.description("Check npm for the latest aislop version")
	.action(async () => {
		await updateCommand();
	});

program
	.command("version")
	.description("Print the installed aislop version")
	.action(() => {
		process.stdout.write(`${APP_VERSION}\n`);
	});

program
	.command("commands")
	.description("List all commands and major flags")
	.action(() => {
		process.stdout.write(renderCommandReference({ version: APP_VERSION }));
	});

registerHookCommand(program);
registerHookAliases(program);

const main = async () => {
	fireInstalledOnce();
	if (shouldRenderPlainVersion()) {
		process.stdout.write(`${APP_VERSION}\n`);
		return;
	}
	if (shouldRenderRootHelp()) {
		process.stdout.write(renderRootHelp({ version: APP_VERSION }));
		return;
	}
	await program.parseAsync();
	await flushTelemetry();
	await maybeNotifyUpdate();
};

main();
