import * as readline from "node:readline";
import { Writable } from "node:stream";
import { symbols } from "./symbols.js";
import { style, theme } from "./theme.js";
import { stringWidth, truncate } from "./width.js";

const silentOutput = new Writable({
	write(_chunk, _encoding, callback) {
		callback();
	},
});

interface SearchItem<T> {
	value: T;
	label: string;
	hint?: string;
	keywords?: string[];
}

interface BaseSearchOptions<T> {
	message: string;
	items: SearchItem<T>[];
	maxVisible?: number;
	required?: boolean;
}

type SearchSelectOptions<T> = BaseSearchOptions<T>;

interface SearchMultiselectOptions<T> extends BaseSearchOptions<T> {
	initialSelected?: T[];
}

interface RenderOptions<T> extends BaseSearchOptions<T> {
	query: string;
	cursor: number;
	selected: Set<T>;
	mode: "single" | "multi";
	state: "active" | "submit" | "cancel";
}

export const filterSearchItems = <T>(items: SearchItem<T>[], query: string): SearchItem<T>[] => {
	const q = query.trim().toLowerCase();
	if (q.length === 0) return items;
	return items
		.map((item, index) => {
			const label = item.label.toLowerCase();
			const value = String(item.value).toLowerCase();
			const hint = item.hint?.toLowerCase() ?? "";
			const keywords = (item.keywords ?? []).join(" ").toLowerCase();
			const haystack = [label, value, hint, keywords].filter((v) => v.length > 0).join(" ");
			const matched = q.split(/\s+/).every((part) => haystack.includes(part));
			if (!matched) return null;
			let rank = 80;
			if (label === q || value === q) rank = 0;
			else if (label.startsWith(q) || value.startsWith(q)) rank = 10;
			else if (label.includes(q) || value.includes(q)) rank = 20;
			else if (keywords.includes(q)) rank = 40;
			else if (hint.includes(q)) rank = 60;
			return { item, index, rank };
		})
		.filter(
			(entry): entry is { item: SearchItem<T>; index: number; rank: number } => entry !== null,
		)
		.sort((a, b) => {
			if (a.rank !== b.rank) return a.rank - b.rank;
			return a.index - b.index;
		})
		.map((entry) => entry.item);
};

const countRows = (lines: string[], columns: number | undefined): number => {
	const width = columns && columns > 0 ? columns : 80;
	return lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(stringWidth(line) / width)), 0);
};

export const renderSearchLines = <T>(options: RenderOptions<T>): string[] => {
	const maxVisible = options.maxVisible ?? 8;
	const filtered = filterSearchItems(options.items, options.query);
	const cursor = Math.max(0, Math.min(options.cursor, Math.max(0, filtered.length - 1)));
	const start = Math.max(
		0,
		Math.min(cursor - Math.floor(maxVisible / 2), filtered.length - maxVisible),
	);
	const visible = filtered.slice(start, start + maxVisible);
	const lines: string[] = [];
	const marker =
		options.state === "cancel"
			? style(theme, "danger", symbols.fail)
			: options.state === "submit"
				? style(theme, "success", symbols.stepDone)
				: style(theme, "accent", symbols.stepActive);

	lines.push(` ${marker} ${style(theme, "bold", options.message)}`);

	if (options.state === "cancel") {
		lines.push(` ${style(theme, "muted", symbols.rail)} ${style(theme, "muted", "Cancelled")}`);
		return lines;
	}

	if (options.state === "submit") {
		const selected = options.items.filter((item) => options.selected.has(item.value));
		const label =
			selected.length > 0 ? selected.map((item) => item.label).join(", ") : "No selection";
		lines.push(` ${style(theme, "muted", symbols.rail)} ${style(theme, "muted", label)}`);
		return lines;
	}

	lines.push(
		` ${style(theme, "muted", symbols.rail)} ${style(theme, "muted", "Search:")} ${options.query}${style(theme, "dim", "_")}`,
	);
	lines.push(
		` ${style(theme, "muted", symbols.rail)} ${style(theme, "muted", options.mode === "multi" ? "type to filter, arrows move, space toggles, enter confirms" : "type to filter, arrows move, enter selects")}`,
	);
	lines.push(` ${style(theme, "muted", symbols.rail)}`);

	if (visible.length === 0) {
		lines.push(` ${style(theme, "muted", symbols.rail)} ${style(theme, "muted", "No matches")}`);
	} else {
		for (const [offset, item] of visible.entries()) {
			const index = start + offset;
			const active = index === cursor;
			const selected = options.selected.has(item.value);
			const pointer = active ? style(theme, "info", symbols.engineActive) : " ";
			const radio =
				options.mode === "multi"
					? selected
						? style(theme, "success", symbols.pass)
						: style(theme, "muted", symbols.pending)
					: active
						? style(theme, "accent", symbols.bullet)
						: style(theme, "muted", symbols.pending);
			const label = active ? style(theme, "bold", item.label) : item.label;
			const hint = item.hint ? ` ${style(theme, "muted", truncate(item.hint, 72))}` : "";
			lines.push(` ${style(theme, "muted", symbols.rail)} ${pointer} ${radio} ${label}${hint}`);
		}
	}

	const hiddenBefore = start;
	const hiddenAfter = Math.max(0, filtered.length - (start + visible.length));
	if (hiddenBefore > 0 || hiddenAfter > 0) {
		const parts: string[] = [];
		if (hiddenBefore > 0) parts.push(`up ${hiddenBefore} more`);
		if (hiddenAfter > 0) parts.push(`down ${hiddenAfter} more`);
		lines.push(
			` ${style(theme, "muted", symbols.rail)} ${style(theme, "muted", parts.join(" · "))}`,
		);
	}

	if (options.mode === "multi") {
		const picked = options.items.filter((item) => options.selected.has(item.value));
		const summary =
			picked.length === 0
				? "Selected: none"
				: picked.length <= 3
					? `Selected: ${picked.map((item) => item.label).join(", ")}`
					: `Selected: ${picked
							.slice(0, 3)
							.map((item) => item.label)
							.join(", ")} +${picked.length - 3} more`;
		lines.push(` ${style(theme, "muted", symbols.rail)}`);
		lines.push(` ${style(theme, "muted", symbols.rail)} ${style(theme, "success", summary)}`);
	}

	lines.push(` ${style(theme, "muted", symbols.railEnd)}`);
	return lines;
};

const runSearchPrompt = async <T>(
	options: BaseSearchOptions<T> & { mode: "single" | "multi"; initialSelected?: T[] },
): Promise<T | T[] | null> => {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return options.mode === "multi" ? (options.initialSelected ?? []) : null;
	}

	return new Promise((resolve) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: silentOutput,
			terminal: false,
		});
		readline.emitKeypressEvents(process.stdin, rl);
		process.stdin.setRawMode(true);

		let query = "";
		let cursor = 0;
		let lastRows = 0;
		const selected = new Set<T>(options.initialSelected ?? []);

		const clear = () => {
			if (lastRows === 0) return;
			process.stdout.write(`\x1b[${lastRows}A`);
			for (let i = 0; i < lastRows; i++) {
				process.stdout.write("\x1b[2K\x1b[1B");
			}
			process.stdout.write(`\x1b[${lastRows}A`);
		};

		const render = (state: "active" | "submit" | "cancel" = "active") => {
			clear();
			const lines = renderSearchLines({ ...options, query, cursor, selected, state });
			process.stdout.write(`${lines.join("\n")}\n`);
			lastRows = countRows(lines, process.stdout.columns);
		};

		const cleanup = () => {
			process.stdin.removeListener("keypress", onKeypress);
			process.stdin.setRawMode(false);
			rl.close();
		};

		const submit = () => {
			const filtered = filterSearchItems(options.items, query);
			const item = filtered[cursor];
			if (options.mode === "single") {
				if (!item) {
					if (options.required) return;
					render("cancel");
					cleanup();
					resolve(null);
					return;
				}
				selected.clear();
				selected.add(item.value);
				render("submit");
				cleanup();
				resolve(item.value);
				return;
			}
			if (options.required && selected.size === 0) return;
			render("submit");
			cleanup();
			resolve([...selected]);
		};

		const cancel = () => {
			render("cancel");
			cleanup();
			resolve(null);
		};

		const onKeypress = (_str: string | undefined, key: readline.Key) => {
			if (!key) return;
			const filtered = filterSearchItems(options.items, query);
			if (key.name === "return") {
				submit();
				return;
			}
			if (key.name === "escape" || (key.ctrl && key.name === "c")) {
				cancel();
				return;
			}
			if (key.name === "up") {
				cursor = Math.max(0, cursor - 1);
				render();
				return;
			}
			if (key.name === "down") {
				cursor = Math.min(Math.max(0, filtered.length - 1), cursor + 1);
				render();
				return;
			}
			if (key.name === "space" && options.mode === "multi") {
				const item = filtered[cursor];
				if (item) {
					if (selected.has(item.value)) selected.delete(item.value);
					else selected.add(item.value);
				}
				render();
				return;
			}
			if (key.name === "backspace") {
				query = query.slice(0, -1);
				cursor = 0;
				render();
				return;
			}
			if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
				query += key.sequence;
				cursor = 0;
				render();
			}
		};

		process.stdin.on("keypress", onKeypress);
		render();
	});
};

export const searchSelect = async <T>(options: SearchSelectOptions<T>): Promise<T | null> =>
	(await runSearchPrompt({ ...options, mode: "single" })) as T | null;

export const searchMultiselect = async <T>(
	options: SearchMultiselectOptions<T>,
): Promise<T[] | null> =>
	(await runSearchPrompt({
		...options,
		mode: "multi",
		initialSelected: options.initialSelected,
	})) as T[] | null;
