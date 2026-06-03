import type { AislopConfig } from "../config/index.js";
import { renderActionEnd, renderActionStart } from "../ui/action-frame.js";
import { renderHome } from "../ui/home.js";
import { searchSelect } from "../ui/search-select.js";
import { APP_VERSION } from "../version.js";
import { doctorCommand } from "./doctor.js";
import { fixCommand } from "./fix.js";
import { hookInstall, hookStatus, promptAgentSelection } from "./hook.js";
import { initCommand } from "./init.js";
import { rulesCommand } from "./rules.js";
import { scanCommand } from "./scan.js";

type Action =
	| "scan"
	| "fix"
	| "hook-install"
	| "hook-status"
	| "init"
	| "doctor"
	| "rules"
	| "quit";

export const INTERACTIVE_OPTIONS = [
	{ value: "scan" as const, label: "Scan", hint: "Score project and show findings" },
	{ value: "fix" as const, label: "Fix", hint: "Auto-fix or hand off remaining findings" },
	{ value: "doctor" as const, label: "Doctor", hint: "Check required tools" },
	{ value: "init" as const, label: "Setup", hint: "Create config and CI workflow" },
	{ value: "rules" as const, label: "Rules", hint: "Explain every check" },
	{ value: "hook-install" as const, label: "Install hooks", hint: "Run aislop after agent edits" },
	{ value: "hook-status" as const, label: "Hook status", hint: "Show installed hooks" },
	{ value: "quit" as const, label: "Quit", hint: "Exit" },
];

const optionFor = (action: Action) => INTERACTIVE_OPTIONS.find((option) => option.value === action);

const run = async (
	action: Action,
	directory: string,
	config: AislopConfig,
): Promise<"complete" | "skipped"> => {
	switch (action) {
		case "scan":
			await scanCommand(directory, config, {
				changes: false,
				staged: false,
				verbose: false,
				json: false,
				printBrand: false,
			});
			return "complete";
		case "fix":
			await fixCommand(directory, config, { verbose: false, printBrand: false });
			return "complete";
		case "hook-install": {
			const agents = await promptAgentSelection("install");
			if (agents === null || agents.length === 0) return "skipped";
			await hookInstall({
				agents,
				scope: "global",
				dryRun: false,
				yes: false,
				qualityGate: false,
			});
			return "complete";
		}
		case "hook-status":
			await hookStatus();
			return "complete";
		case "init":
			await initCommand(directory, { printBrand: false });
			return "complete";
		case "doctor":
			await doctorCommand(directory, { printBrand: false });
			return "complete";
		case "rules":
			await rulesCommand(directory, { printBrand: false, interactive: true });
			return "complete";
		case "quit":
			return "skipped";
	}
};

const runFramed = async (
	action: Action,
	directory: string,
	config: AislopConfig,
): Promise<void> => {
	const option = optionFor(action);
	const label = option?.label ?? action;
	process.stdout.write(renderActionStart({ label, hint: option?.hint }));
	const status = await run(action, directory, config);
	process.stdout.write(renderActionEnd({ label, status }));
};

export const interactiveCommand = async (
	directory: string,
	config: AislopConfig,
): Promise<void> => {
	process.stdout.write(`${renderHome({ version: APP_VERSION })}\n`);
	const picked = await searchSelect<Action>({
		message: "What would you like to do?",
		items: INTERACTIVE_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
	});
	if (picked === null || picked === "quit") return;
	await runFramed(picked as Action, directory, config);

	while (true) {
		const again = await searchSelect<Action>({
			message: "Next action?",
			items: INTERACTIVE_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
		});
		if (again === null || again === "quit") return;
		await runFramed(again as Action, directory, config);
	}
};
