import { existsSync } from "node:fs";
import { Command } from "commander";
import { registerAgentCommand } from "./cli/agent-command.js";
import { registerHookAliases, registerHookCommand } from "./cli/hook-command.js";
import { registerExtraCommands } from "./cli-extra-commands.js";
import { FIX_AGENT_FLAGS, matchFixAgent } from "./cli-fix-agents.js";
import { commaSeparatedParser, noFlagsPassed, runScan, type ScanFlags } from "./cli-scan.js";
import { ciCommand } from "./commands/ci.js";
import { doctorCommand } from "./commands/doctor.js";
import { fixCommand } from "./commands/fix.js";
import { initCommand } from "./commands/init.js";
import { interactiveCommand } from "./commands/interactive.js";
import { loadConfig } from "./config/index.js";
import {
	ensureInstallId,
	flushTelemetry,
	isTelemetryDisabled,
	resolveInstallIdPath,
	track,
	withCommandLifecycle,
} from "./telemetry/index.js";
import { renderRootHelp } from "./ui/home.js";
import { log } from "./ui/logger.js";
import { suggestClosest } from "./ui/suggest.js";
import { maybeNotifyUpdate } from "./update-notifier.js";
import { killActiveChildren } from "./utils/subprocess.js";
import { APP_VERSION } from "./version.js";

// Reap any scanner still running before exiting: on POSIX the tools are spawned
// in their own process groups, so a Ctrl-C to the CLI's group would otherwise
// leave them orphaned (win32 children share the console and get Ctrl-C anyway).
const handleTerminationSignal = (): void => {
	killActiveChildren();
	process.exit(0);
};
process.on("SIGINT", handleTerminationSignal);
process.on("SIGTERM", handleTerminationSignal);

const fireInstalledOnce = (): void => {
	if (isTelemetryDisabled(loadConfig(process.cwd()).telemetry)) return;
	const ensured = ensureInstallId(resolveInstallIdPath());
	if (ensured.created) {
		track({ event: "cli_installed", config: loadConfig(process.cwd()).telemetry });
	}
};

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
	.showSuggestionAfterError()
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

const fixProgram = program
	.command("fix [directory]")
	.description("Auto-fix findings or hand off to a coding agent")
	.option("-d, --verbose", "show detailed fix progress")
	.option("-f, --force", "run aggressive fixes (audit and framework dependency alignment)")
	.option(
		"--safe",
		"only apply reversible fixes (imports, comment removal, safe formatters); skip anything that deletes code, rewrites behaviour, or runs unsafe formatter configs",
	)
	.option("-p, --prompt", "print a prompt for your coding agent to fix remaining issues");

for (const a of FIX_AGENT_FLAGS) fixProgram.option(`--${a.flag}`, a.help);

fixProgram.action(async (directory = ".", _flags, command) => {
	const flags = command.optsWithGlobals() as Record<string, boolean | undefined>;
	const { exitCode } = await fixCommand(directory, loadConfig(directory), {
		verbose: Boolean(flags.verbose),
		force: Boolean(flags.force),
		safe: Boolean(flags.safe),
		prompt: Boolean(flags.prompt),
		agent: matchFixAgent(flags),
	});
	if (exitCode !== 0) {
		await flushTelemetry();
		process.exitCode = exitCode;
	}
});

registerAgentCommand(program);

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
registerExtraCommands(program);

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
	// A bare first token that isn't a known command, a flag, or an existing path is
	// almost always a mistyped command. Catch it up front (any arg count) and suggest
	// the closest command, rather than scanning a non-existent directory or erroring obscurely.
	const firstArg = process.argv[2];
	if (firstArg && !firstArg.startsWith("-")) {
		const known = new Set(
			program.commands.flatMap((command) => [command.name(), ...command.aliases()]),
		);
		if (!known.has(firstArg) && !existsSync(firstArg)) {
			const guess = suggestClosest(firstArg, [...known]);
			log.error(`"${firstArg}" is not a known command or an existing path.`);
			if (guess) log.muted(`Did you mean \`aislop ${guess}\`?`);
			log.muted("Run `aislop --help` to see all commands.");
			process.exitCode = 1;
			return;
		}
	}
	await program.parseAsync();
	await flushTelemetry();
	await maybeNotifyUpdate();
};

main();
