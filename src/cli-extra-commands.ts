import type { Command } from "commander";
import { badgeCommand } from "./commands/badge.js";
import { rulesCommand } from "./commands/rules.js";
import { trendCommand } from "./commands/trend.js";
import { updateCommand } from "./commands/update.js";
import { loadConfig } from "./config/index.js";
import { withCommandLifecycle } from "./telemetry/index.js";
import { renderCommandReference } from "./ui/home.js";
import { APP_VERSION } from "./version.js";

export const registerExtraCommands = (program: Command): void => {
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
		.alias("trends")
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
};
