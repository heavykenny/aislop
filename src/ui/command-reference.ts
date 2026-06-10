import { APP_VERSION } from "../version.js";
import { highlightAislop } from "./brand.js";
import {
	COMMAND_REFERENCE,
	type CommandReference,
	EXAMPLE_ROWS,
	FLAG_GUIDE_ROWS,
	GUIDE_ROWS,
} from "./command-reference-data.js";
import { renderDisplayRows, renderDisplaySection } from "./display.js";
import { renderHeader } from "./header.js";
import { renderHintLine } from "./logger.js";
import { style, theme } from "./theme.js";
import { padEnd } from "./width.js";

interface CommandGroup {
	label: string;
	items: CommandReference[];
}

const MAX_FLAG_LINE_WIDTH = 120;

const commandGroupLabel = (command: string): string => {
	if (command.startsWith("aislop agent")) return "Local Agent";
	if (command.startsWith("aislop scan")) return "Core Workflow";
	if (command.startsWith("aislop fix")) return "Core Workflow";
	if (command.startsWith("aislop ci")) return "Core Workflow";
	if (command.startsWith("aislop hook")) return "Hooks";
	if (command === "aislop hooks") return "Hooks";
	if (command.startsWith("aislop install")) return "Hooks";
	if (command.startsWith("aislop uninstall")) return "Hooks";
	if (command.startsWith("aislop init")) return "Project Setup";
	if (command.startsWith("aislop doctor")) return "Project Setup";
	if (command.startsWith("aislop rules")) return "Project Setup";
	if (command.startsWith("aislop badge")) return "Reporting";
	if (command.startsWith("aislop trend")) return "Reporting";
	return "General";
};

const groupedCommands = (): CommandGroup[] => {
	const order = ["General", "Core Workflow", "Local Agent", "Project Setup", "Hooks", "Reporting"];
	const byGroup = new Map<string, CommandReference[]>();
	for (const label of order) byGroup.set(label, []);
	for (const item of COMMAND_REFERENCE) {
		const label = commandGroupLabel(item.command);
		byGroup.set(label, [...(byGroup.get(label) ?? []), item]);
	}
	return order
		.map((label) => ({ label, items: byGroup.get(label) ?? [] }))
		.filter((group) => group.items.length > 0);
};

const sentenceCase = (value: string): string =>
	value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}`;

const wrapFlags = (flags: string[], commandWidth: number): string[] => {
	const label = "flags:";
	const flagLabelColumn = commandWidth + 3;
	const flagValueColumn = flagLabelColumn + label.length + 2;
	const firstPrefix = `${" ".repeat(flagLabelColumn)}${label}  `;
	const nextPrefix = `${" ".repeat(flagValueColumn)}`;
	const lines: string[] = [];
	let current = firstPrefix;

	for (const flag of flags) {
		const addition = current === firstPrefix || current === nextPrefix ? flag : `  ${flag}`;
		if (current !== firstPrefix && current.length + addition.length > MAX_FLAG_LINE_WIDTH) {
			lines.push(current);
			current = `${nextPrefix}${flag}`;
			continue;
		}
		current += addition;
	}
	if (current.trim()) lines.push(current);
	return lines;
};

const renderFlagLine = (line: string): string => {
	const labelStart = line.indexOf("flags:");
	if (labelStart === -1) return style(theme, "dim", line);
	const labelEnd = labelStart + "flags:".length;
	return `${line.slice(0, labelStart)}${style(theme, "accentDim", "flags:")}${style(theme, "dim", line.slice(labelEnd))}`;
};

const renderCommandGroup = (group: CommandGroup, commandWidth: number): string[] => {
	const lines = ["", style(theme, "section", sentenceCase(group.label))];
	for (const item of group.items) {
		lines.push(
			` ${highlightAislop(padEnd(item.command, commandWidth), theme)}  ${style(theme, "fg", item.summary)}`,
		);
		if (item.flags?.length) {
			for (const line of wrapFlags(item.flags, commandWidth)) lines.push(renderFlagLine(line));
		}
	}
	return lines;
};

export const renderCommandReference = (input: { version?: string } = {}): string => {
	const version = input.version ?? APP_VERSION;
	const commandWidth = Math.max(...COMMAND_REFERENCE.map((item) => item.command.length));
	const lines = [renderHeader({ version, command: "Commands", context: ["full list"] }).trimEnd()];

	lines.push(
		"",
		renderDisplaySection("Guide"),
		...renderDisplayRows(GUIDE_ROWS, { labelWidth: 9 }),
		"",
		renderDisplaySection("Examples"),
		...renderDisplayRows(EXAMPLE_ROWS, { labelWidth: 9 }),
		"",
		renderDisplaySection("Flag guide"),
		...renderDisplayRows(FLAG_GUIDE_ROWS, { labelWidth: 10 }),
	);

	for (const group of groupedCommands()) lines.push(...renderCommandGroup(group, commandWidth));

	lines.push(
		"",
		renderDisplaySection("Scope files"),
		...renderDisplayRows(
			[
				{ label: ".aislopignore", value: "skip generated, vendored, or noisy paths" },
				{ label: ".gitignore", value: "respected for untracked files" },
			],
			{ labelWidth: 13 },
		),
	);
	lines.push(
		"",
		renderHintLine("Run aislop <command> --help for complete command-specific options").trimEnd(),
	);
	return `${lines.join("\n")}\n`;
};
