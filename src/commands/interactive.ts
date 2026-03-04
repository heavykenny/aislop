import { select } from "@inquirer/prompts";
import type { SlopConfig } from "../config/index.js";
import { highlighter } from "../utils/highlighter.js";
import { logger } from "../utils/logger.js";
import { doctorCommand } from "./doctor.js";
import { fixCommand } from "./fix.js";
import { initCommand } from "./init.js";
import { rulesCommand } from "./rules.js";
import { scanCommand } from "./scan.js";

type InteractiveAction = "scan" | "fix" | "init" | "doctor" | "rules" | "quit";

const MENU_THEME = {
	prefix: {
		idle: "",
		done: "",
	},
	icon: {
		cursor: "➤",
	},
	style: {
		answer: () => "",
		message: (text: string, status: string) =>
			status === "done" ? "" : highlighter.bold(text),
		keysHelpTip: () => undefined,
	},
	indexMode: "hidden" as const,
};

export const interactiveCommand = async (
	directory: string,
	config: SlopConfig,
): Promise<void> => {
	logger.log(highlighter.bold(`Slope v${process.env.VERSION ?? "0.1.0"}`));
	logger.dim("↑↓ Navigate | Enter Select | Ctrl+C Exit");
	logger.break();

	const action = await select<InteractiveAction>(
		{
			message: "Action",
			theme: MENU_THEME,
			choices: [
				{
					name: "1. Scan      Analyze code quality and risk",
					value: "scan",
				},
				{
					name: "2. Fix       Apply safe auto-fixes",
					value: "fix",
				},
				{
					name: "3. Init      Create slop config files",
					value: "init",
				},
				{
					name: "4. Doctor    Check toolchain and coverage",
					value: "doctor",
				},
				{
					name: "5. Rules     List all rule families",
					value: "rules",
				},
				{
					name: "Q. Quit      Exit",
					value: "quit",
				},
			],
		},
		{ clearPromptOnDone: true },
	);

	// Clear the menu screen to hand off cleanly to the selected command output.
	if (process.stdout.isTTY && action !== "quit") {
		process.stdout.write("\u001B[2J\u001B[H");
	}

	switch (action) {
		case "scan":
			await scanCommand(directory, config, {
				changes: false,
				staged: false,
				verbose: false,
				json: false,
				showHeader: false,
			});
			break;
		case "fix":
			await fixCommand(directory, config, {
				verbose: false,
				showHeader: false,
			});
			break;
		case "init":
			await initCommand(directory);
			break;
		case "doctor":
			await doctorCommand(directory);
			break;
		case "rules":
			await rulesCommand(directory);
			break;
		case "quit":
			return;
	}
};
