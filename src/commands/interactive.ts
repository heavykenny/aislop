import type { AislopConfig } from "../config/index.js";
import { doctorCommand } from "./doctor.js";
import { fixCommand } from "./fix.js";
import { initCommand } from "./init.js";
import { rulesCommand } from "./rules.js";
import { scanCommand } from "./scan.js";
import { renderHeader } from "../ui/header.js";
import { isCancel, select } from "../ui/prompts.js";
import { APP_VERSION } from "../version.js";

type Action = "scan" | "fix" | "init" | "doctor" | "rules" | "quit";

export const INTERACTIVE_OPTIONS = [
	{ value: "scan" as const, label: "Scan", hint: "Analyze code quality and risk" },
	{ value: "fix" as const, label: "Fix", hint: "Apply safe auto-fixes" },
	{ value: "init" as const, label: "Init", hint: "Create aislop config" },
	{ value: "doctor" as const, label: "Doctor", hint: "Check toolchain" },
	{ value: "rules" as const, label: "Rules", hint: "List all rules" },
	{ value: "quit" as const, label: "Quit", hint: "Exit" },
];

const run = async (action: Action, directory: string, config: AislopConfig): Promise<void> => {
	switch (action) {
		case "scan":
			await scanCommand(directory, config, {
				changes: false,
				staged: false,
				verbose: false,
				json: false,
				printBrand: false,
			});
			return;
		case "fix":
			await fixCommand(directory, config, { verbose: false, printBrand: false });
			return;
		case "init":
			await initCommand(directory, { printBrand: false });
			return;
		case "doctor":
			await doctorCommand(directory, { printBrand: false });
			return;
		case "rules":
			await rulesCommand(directory, { printBrand: false });
			return;
		case "quit":
			return;
	}
};

export const interactiveCommand = async (
	directory: string,
	config: AislopConfig,
): Promise<void> => {
	process.stdout.write(renderHeader({ version: APP_VERSION, command: "--bare", context: [] }));
	const picked = await select({
		message: "What would you like to do?",
		options: INTERACTIVE_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
	});
	if (isCancel(picked) || picked === "quit") return;
	await run(picked as Action, directory, config);

	while (true) {
		const again = await select({
			message: "Next?",
			options: INTERACTIVE_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
		});
		if (isCancel(again) || again === "quit") return;
		await run(again as Action, directory, config);
	}
};
