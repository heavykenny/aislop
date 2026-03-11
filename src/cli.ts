import { Command } from "commander";
import { ciCommand } from "./commands/ci.js";
import { doctorCommand } from "./commands/doctor.js";
import { fixCommand } from "./commands/fix.js";
import { initCommand } from "./commands/init.js";
import { interactiveCommand } from "./commands/interactive.js";
import { rulesCommand } from "./commands/rules.js";
import { scanCommand } from "./commands/scan.js";
import { loadConfig } from "./config/index.js";
import { highlighter } from "./utils/highlighter.js";
import { APP_VERSION } from "./version.js";

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

const program = new Command()
	.name("slop")
	.description("The unified code quality CLI")
	.version(APP_VERSION, "-v, --version")
	.argument("[directory]", "project directory to scan", ".")
	.option("--changes", "only scan changed files (git diff)")
	.option("--staged", "only scan staged files")
	.option("-d, --verbose", "show file details per rule")
	.option("--json", "output JSON instead of terminal UI")
	.action(
		async (
			directory: string,
			flags: {
				changes?: boolean;
				staged?: boolean;
				verbose?: boolean;
				json?: boolean;
			},
		) => {
			const config = loadConfig(directory);

			// If no flags, show interactive menu (if TTY)
			if (
				!flags.changes &&
				!flags.staged &&
				!flags.verbose &&
				!flags.json &&
				process.stdin.isTTY
			) {
				try {
					await interactiveCommand(directory, config);
					return;
				} catch {
					// Fall through to scan if interactive fails
				}
			}

			const { exitCode } = await scanCommand(directory, config, {
				changes: Boolean(flags.changes),
				staged: Boolean(flags.staged),
				verbose: Boolean(flags.verbose),
				json: Boolean(flags.json),
			});

			if (exitCode !== 0) process.exit(exitCode);
		},
	)
	.addHelpText(
		"after",
		`
${highlighter.dim("Commands:")}
  slop scan [dir]      Full code quality scan
  slop fix [dir]       Auto-fix formatting and lint issues
  slop init [dir]      Initialize slop config
  slop doctor [dir]    Check installed tools
  slop ci [dir]        CI-friendly JSON output
  slop rules [dir]     List all rules

${highlighter.dim("Examples:")}
  slop                 Interactive menu
  slop scan            Scan entire project
  slop scan -d         Scan with file/line details
  slop scan --changes  Scan only changed files
  slop scan --staged   Scan only staged files (for hooks)
  slop fix             Auto-fix issues
  slop ci              JSON output for CI pipelines
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
	.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as {
			changes?: boolean;
			staged?: boolean;
			verbose?: boolean;
			json?: boolean;
		};
		const config = loadConfig(directory);
		const { exitCode } = await scanCommand(directory, config, {
			changes: Boolean(flags.changes),
			staged: Boolean(flags.staged),
			verbose: Boolean(flags.verbose),
			json: Boolean(flags.json),
		});
		if (exitCode !== 0) process.exit(exitCode);
	});

program
	.command("fix [directory]")
	.description("Auto-fix formatting and lint issues")
	.option("-d, --verbose", "show detailed fix progress")
	.action(async (directory = ".", _flags, command) => {
		const flags = command.optsWithGlobals() as { verbose?: boolean };
		const config = loadConfig(directory);
		await fixCommand(directory, config, { verbose: Boolean(flags.verbose) });
	});

program
	.command("init [directory]")
	.description("Initialize slop config in project")
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
	.action(async (directory = ".") => {
		const config = loadConfig(directory);
		const { exitCode } = await ciCommand(directory, config);
		if (exitCode !== 0) process.exit(exitCode);
	});

program
	.command("rules [directory]")
	.description("List all available rules")
	.action(async (directory = ".") => {
		await rulesCommand(directory);
	});

const main = async () => {
	await program.parseAsync();
};

main();
