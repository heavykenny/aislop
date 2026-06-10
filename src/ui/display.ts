import { highlightAislop } from "./brand.js";
import { theme as defaultTheme, style, type Theme, type Token } from "./theme.js";
import { padEnd } from "./width.js";

export interface DisplayRow {
	label: string;
	value: string;
	valueToken?: Token;
}

export interface DisplayStatusItem {
	marker: string;
	label: string;
	rows: DisplayRow[];
}

interface DisplayDeps {
	theme?: Theme;
}

interface RowOptions extends DisplayDeps {
	indent?: number;
	labelWidth?: number;
}

interface StatusListOptions extends RowOptions {
	itemGap?: boolean;
	itemIndent?: number;
}

export const renderDisplaySection = (label: string, deps: DisplayDeps = {}): string => {
	const t = deps.theme ?? defaultTheme;
	return style(t, "section", label);
};

export const renderDisplayRows = (rows: DisplayRow[], options: RowOptions = {}): string[] => {
	if (rows.length === 0) return [];
	const t = options.theme ?? defaultTheme;
	const indent = " ".repeat(options.indent ?? 3);
	const labelWidth = options.labelWidth ?? Math.max(...rows.map((row) => row.label.length));
	return rows.map((row) => {
		const label = style(t, "muted", padEnd(row.label, labelWidth));
		const value = highlightAislop(row.value, t, row.valueToken);
		return `${indent}${label}  ${value}`;
	});
};

export const renderDisplayStatusItems = (
	items: DisplayStatusItem[],
	options: StatusListOptions = {},
): string[] => {
	const t = options.theme ?? defaultTheme;
	const itemIndent = " ".repeat(options.itemIndent ?? 1);
	const labelWidth =
		options.labelWidth ??
		Math.max(0, ...items.flatMap((item) => item.rows.map((row) => row.label.length)));
	const rowOptions: RowOptions = {
		theme: t,
		indent: options.indent ?? 3,
		labelWidth: labelWidth > 0 ? labelWidth : undefined,
	};
	const lines: string[] = [];
	for (const [index, item] of items.entries()) {
		lines.push(`${itemIndent}${item.marker} ${style(t, "bold", item.label)}`);
		lines.push(...renderDisplayRows(item.rows, rowOptions));
		if (options.itemGap !== false && index < items.length - 1) lines.push("");
	}
	return lines;
};

export const renderDisplayCommandRows = (
	rows: Array<{ label: string; command: string }>,
	options: RowOptions = {},
): string[] =>
	renderDisplayRows(
		rows.map((row) => ({ label: row.label, value: row.command })),
		options,
	);
