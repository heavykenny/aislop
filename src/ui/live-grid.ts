import type { EngineName } from "../engines/types.js";
import { symbols as defaultSymbols, type Symbols } from "./symbols.js";
import { style, theme as defaultTheme, type Theme, type Token } from "./theme.js";
import { padEnd, padStart } from "./width.js";

export type GridRowStatus = "queued" | "running" | "done" | "skipped";
export type GridRowOutcome = "ok" | "warn" | "fail";

export interface GridRow {
	label: string;
	status: GridRowStatus;
	outcome?: GridRowOutcome;
	summary?: string;
	elapsedMs?: number;
	key?: EngineName | string;
}

interface GridInput {
	rows: GridRow[];
}

interface GridDeps {
	theme?: Theme;
	symbols?: Symbols;
	labelWidth?: number;
	statusWidth?: number;
	elapsedWidth?: number;
	spinnerFrame?: number;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const fmtElapsed = (ms?: number): string =>
	ms === undefined ? "—" : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

const glyphFor = (row: GridRow, s: Symbols, frame: number): { glyph: string; token: Token } => {
	if (row.status === "skipped") return { glyph: s.neutral, token: "muted" };
	if (row.status === "queued") return { glyph: s.pending, token: "muted" };
	if (row.status === "running") return { glyph: SPINNER[frame % SPINNER.length], token: "info" };
	if (row.outcome === "fail") return { glyph: s.fail, token: "danger" };
	if (row.outcome === "warn") return { glyph: s.warn, token: "warn" };
	return { glyph: s.pass, token: "success" };
};

const statusText = (row: GridRow): string => {
	if (row.summary) return row.summary;
	if (row.status === "running") return "running";
	if (row.status === "queued") return "queued";
	if (row.status === "skipped") return "skipped";
	return "done";
};

export const renderGridFrame = (input: GridInput, deps: GridDeps = {}): string => {
	const t = deps.theme ?? defaultTheme;
	const s = deps.symbols ?? defaultSymbols;
	const labelW = deps.labelWidth ?? 18;
	const statusW = deps.statusWidth ?? 12;
	const elapsedW = deps.elapsedWidth ?? 6;
	const frame = deps.spinnerFrame ?? 0;

	const lines = input.rows.map((row) => {
		const { glyph, token } = glyphFor(row, s, frame);
		const label = padEnd(row.label, labelW);
		const status = padEnd(statusText(row), statusW);
		const elapsed = padStart(fmtElapsed(row.elapsedMs), elapsedW);
		return ` ${style(t, token, glyph)} ${label}  ${style(t, "muted", status)}  ${style(t, "muted", elapsed)}`;
	});

	return `${lines.join("\n")}\n`;
};

export class LiveGrid {
	private rows: GridRow[];
	private frame = 0;
	private previousLines = 0;
	private timer: NodeJS.Timeout | undefined;
	private readonly write: (s: string) => void;
	private readonly tty: boolean;

	constructor(rows: GridRow[], opts: { write?: (s: string) => void; tty?: boolean } = {}) {
		this.rows = rows;
		this.write = opts.write ?? ((s) => process.stderr.write(s));
		this.tty = opts.tty ?? Boolean(process.stderr.isTTY);
	}

	start(): void {
		if (!this.tty) return;
		this.render();
		this.timer = setInterval(() => {
			this.frame += 1;
			this.render();
		}, 100);
		this.timer.unref();
	}

	update(key: string, patch: Partial<GridRow>): void {
		const row = this.rows.find((r) => (r.key ?? r.label) === key);
		if (!row) return;
		Object.assign(row, patch);
		this.render();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		if (!this.tty) {
			for (const row of this.rows) {
				this.write(`${row.label} ${statusText(row)} ${fmtElapsed(row.elapsedMs)}\n`);
			}
			return;
		}
		this.render();
	}

	private render(): void {
		if (!this.tty) return;
		if (this.previousLines > 0) {
			this.write(`\x1B[${this.previousLines}F`);
			for (let i = 0; i < this.previousLines; i += 1) {
				this.write("\x1B[2K");
				if (i < this.previousLines - 1) this.write("\x1B[1E");
			}
			if (this.previousLines > 1) this.write(`\x1B[${this.previousLines - 1}F`);
		}
		const out = renderGridFrame({ rows: this.rows }, { spinnerFrame: this.frame });
		this.write(out);
		this.previousLines = out.split("\n").length - 1;
	}
}
