import { emitKeypressEvents } from "node:readline";
import type { SlopConfig } from "../config/index.js";
import { highlighter } from "../utils/highlighter.js";
import { APP_VERSION } from "../version.js";
import { doctorCommand } from "./doctor.js";
import { fixCommand } from "./fix.js";
import { initCommand } from "./init.js";
import { rulesCommand } from "./rules.js";
import { scanCommand } from "./scan.js";

type InteractiveAction = "scan" | "fix" | "init" | "doctor" | "rules" | "quit";

interface InteractiveMenuOption {
	key: string;
	action: InteractiveAction;
	label: string;
	description: string;
}

const MENU_OPTIONS: InteractiveMenuOption[] = [
	{
		key: "1",
		action: "scan",
		label: "Scan",
		description: "Analyze code quality and risk",
	},
	{
		key: "2",
		action: "fix",
		label: "Fix",
		description: "Apply safe auto-fixes",
	},
	{
		key: "3",
		action: "init",
		label: "Init",
		description: "Create slop config files",
	},
	{
		key: "4",
		action: "doctor",
		label: "Doctor",
		description: "Check toolchain and coverage",
	},
	{
		key: "5",
		action: "rules",
		label: "Rules",
		description: "List all rule families",
	},
	{
		key: "Q",
		action: "quit",
		label: "Quit",
		description: "Exit",
	},
];

const MENU_LABEL_WIDTH = Math.max(
	...MENU_OPTIONS.map((option) => option.label.length),
);

const clearRenderedLines = (lineCount: number): void => {
	if (lineCount === 0) return;

	process.stdout.write(`\u001B[${lineCount}F`);
	for (let index = 0; index < lineCount; index += 1) {
		process.stdout.write("\u001B[2K");
		if (index < lineCount - 1) {
			process.stdout.write("\u001B[1E");
		}
	}
	if (lineCount > 1) {
		process.stdout.write(`\u001B[${lineCount - 1}F`);
	}
};

export const parseInteractiveActionInput = (
	input: string,
): InteractiveAction | null => {
	const normalized = input.trim().toLowerCase();

	switch (normalized) {
		case "1":
		case "scan":
		case "s":
			return "scan";
		case "2":
		case "fix":
		case "f":
			return "fix";
		case "3":
		case "init":
		case "i":
			return "init";
		case "4":
		case "doctor":
		case "d":
			return "doctor";
		case "5":
		case "rules":
		case "r":
			return "rules";
		case "q":
		case "quit":
			return "quit";
		default:
			return null;
	}
};

export const moveInteractiveSelection = (
	currentIndex: number,
	direction: -1 | 1,
): number => {
	const nextIndex = currentIndex + direction;
	if (nextIndex < 0) return MENU_OPTIONS.length - 1;
	if (nextIndex >= MENU_OPTIONS.length) return 0;
	return nextIndex;
};

const renderInteractiveMenu = (selectedIndex: number): string => {
	const lines = [
		highlighter.bold(`slop v${APP_VERSION}`),
		highlighter.dim("Use ↑↓ or 1-5, Enter select, q quit, Ctrl+C exit"),
		"",
		...MENU_OPTIONS.map((option, index) => {
			const cursor = index === selectedIndex ? "➤" : " ";
			const paddedLabel = option.label.padEnd(MENU_LABEL_WIDTH, " ");
			const label =
				index === selectedIndex ? highlighter.bold(paddedLabel) : paddedLabel;
			return `${cursor} ${option.key}. ${label}  ${option.description}`;
		}),
		"",
	];

	return `${lines.join("\n")}\n`;
};

const promptForAction = async (): Promise<InteractiveAction> =>
	new Promise((resolve) => {
		let selectedIndex = 0;
		let renderedLineCount = 0;

		const render = () => {
			if (renderedLineCount > 0) {
				clearRenderedLines(renderedLineCount);
			}

			const output = renderInteractiveMenu(selectedIndex);
			process.stdout.write(output);
			renderedLineCount = output.split("\n").length - 1;
		};

		const cleanup = () => {
			process.stdin.removeListener("keypress", onKeypress);
			if (process.stdin.isTTY) {
				process.stdin.setRawMode(false);
			}
			process.stdin.pause();
		};

		const finish = (action: InteractiveAction) => {
			cleanup();
			resolve(action);
		};

		const onKeypress = (
			str: string,
			key: { name?: string; ctrl?: boolean },
		) => {
			if (key.ctrl && key.name === "c") {
				process.stdout.write("\n");
				finish("quit");
				return;
			}

			if (key.name === "up") {
				selectedIndex = moveInteractiveSelection(selectedIndex, -1);
				render();
				return;
			}

			if (key.name === "down") {
				selectedIndex = moveInteractiveSelection(selectedIndex, 1);
				render();
				return;
			}

			if (key.name === "return" || key.name === "enter") {
				finish(MENU_OPTIONS[selectedIndex].action);
				return;
			}

			const action = parseInteractiveActionInput(str);
			if (action) {
				finish(action);
			}
		};

		emitKeypressEvents(process.stdin);
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
		}
		process.stdin.resume();
		process.stdin.on("keypress", onKeypress);
		render();
	});

const promptForNextAction = async (): Promise<InteractiveAction | "menu"> =>
	new Promise((resolve) => {
		const message = "\nNext: Enter menu, 1-5 run another command, q quit. ";

		const cleanup = () => {
			process.stdin.removeListener("keypress", onKeypress);
			if (process.stdin.isTTY) {
				process.stdin.setRawMode(false);
			}
			process.stdin.pause();
		};

		const finish = (action: InteractiveAction | "menu") => {
			cleanup();
			process.stdout.write("\n");
			resolve(action);
		};

		const onKeypress = (
			str: string,
			key: { name?: string; ctrl?: boolean },
		) => {
			if (key.ctrl && key.name === "c") {
				finish("quit");
				return;
			}

			if (key.name === "return" || key.name === "enter") {
				finish("menu");
				return;
			}

			const action = parseInteractiveActionInput(str);
			if (action) {
				finish(action);
			}
		};

		process.stdout.write(message);
		emitKeypressEvents(process.stdin);
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
		}
		process.stdin.resume();
		process.stdin.on("keypress", onKeypress);
	});

const runInteractiveAction = async (
	action: InteractiveAction,
	directory: string,
	config: SlopConfig,
): Promise<void> => {
	switch (action) {
		case "scan":
			await scanCommand(directory, config, {
				changes: false,
				staged: false,
				verbose: false,
				json: false,
				showHeader: false,
			});
			return;
		case "fix":
			await fixCommand(directory, config, {
				verbose: false,
				showHeader: false,
			});
			return;
		case "init":
			await initCommand(directory);
			return;
		case "doctor":
			await doctorCommand(directory);
			return;
		case "rules":
			await rulesCommand(directory);
			return;
		case "quit":
			return;
	}
};

export const interactiveCommand = async (
	directory: string,
	config: SlopConfig,
): Promise<void> => {
	let action: InteractiveAction | "menu" = "menu";

	while (true) {
		if (action === "menu") {
			action = await promptForAction();
		}

		if (action === "quit") {
			return;
		}

		if (process.stdout.isTTY) {
			process.stdout.write("\u001B[2J\u001B[H");
		}

		await runInteractiveAction(action, directory, config);

		action = await promptForNextAction();
		if (action === "menu" && process.stdout.isTTY) {
			process.stdout.write("\u001B[2J\u001B[H");
		}
	}
};
