import { select } from "@inquirer/prompts";
import type { SlopConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { doctorCommand } from "./doctor.js";
import { fixCommand } from "./fix.js";
import { initCommand } from "./init.js";
import { rulesCommand } from "./rules.js";
import { scanCommand } from "./scan.js";

export const interactiveCommand = async (
	directory: string,
	config: SlopConfig,
): Promise<void> => {
	logger.log(`slop v${process.env.VERSION ?? "0.1.0"}`);
	logger.break();

	const action = await select({
		message: "What would you like to do?",
		choices: [
			{
				name: "Scan",
				value: "scan",
				description: "Run full code quality scan",
			},
			{
				name: "Fix",
				value: "fix",
				description: "Auto-fix formatting and lint issues",
			},
			{
				name: "Init",
				value: "init",
				description: "Initialize slop config in this project",
			},
			{
				name: "Doctor",
				value: "doctor",
				description: "Check installed tools and environment",
			},
			{
				name: "Rules",
				value: "rules",
				description: "List all available rules",
			},
		],
	});

	logger.break();

	switch (action) {
		case "scan":
			await scanCommand(directory, config, {
				changes: false,
				staged: false,
				verbose: false,
				json: false,
			});
			break;
		case "fix":
			await fixCommand(directory, config);
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
	}
};
