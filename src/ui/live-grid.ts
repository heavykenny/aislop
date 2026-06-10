import type { EngineName } from "../engines/types.js";
import { symbols as defaultSymbols, type Symbols } from "./symbols.js";
import { theme as defaultTheme, style, type Theme, type Token } from "./theme.js";
import { padEnd, padStart, truncate } from "./width.js";

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
	columns?: number;
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

const isComplete = (row: GridRow): boolean => row.status === "done" || row.status === "skipped";

const summarizeActiveRows = (rows: GridRow[]): string => {
	const running = rows.filter((row) => row.status === "running");
	if (running.length > 0) {
		const labels = running.slice(0, 2).map((row) => row.label);
		const extra = running.length > labels.length ? ` +${running.length - labels.length}` : "";
		return `running ${labels.join(", ")}${extra}`;
	}

	const queued = rows.filter((row) => row.status === "queued");
	if (queued.length === rows.length) return "starting";

	const issueRows = rows
		.filter((row) => isComplete(row) && row.summary && row.summary !== "0 issues")
		.slice(0, 2)
		.map((row) => `${row.label}: ${row.summary}`);
	if (issueRows.length > 0) return issueRows.join(" · ");

	return "finishing";
};

const progressOutcome = (rows: GridRow[]): GridRowOutcome | "running" | "queued" => {
	if (rows.some((row) => row.status === "running")) return "running";
	if (rows.every((row) => row.status === "queued")) return "queued";
	if (rows.some((row) => row.outcome === "fail")) return "fail";
	if (rows.some((row) => row.outcome === "warn")) return "warn";
	return "ok";
};

export const renderProgressLine = (input: GridInput, deps: GridDeps = {}): string => {
	const t = deps.theme ?? defaultTheme;
	const s = deps.symbols ?? defaultSymbols;
	const rows = input.rows;
	const total = rows.length;
	const complete = rows.filter(isComplete).length;
	const outcome = progressOutcome(rows);
	const token: Token =
		outcome === "fail"
			? "danger"
			: outcome === "warn"
				? "warn"
				: outcome === "running"
					? "info"
					: "muted";
	const glyph =
		outcome === "running"
			? SPINNER[(deps.spinnerFrame ?? 0) % SPINNER.length]
			: outcome === "fail"
				? s.fail
				: outcome === "warn"
					? s.warn
					: outcome === "ok"
						? s.pass
						: s.pending;
	const status = summarizeActiveRows(rows);
	const raw = `Scan ${complete}/${total} engines · ${status}`;
	const columns = Math.max(32, deps.columns ?? 120);
	const line = truncate(raw, Math.max(12, columns - 3));
	return ` ${style(t, token, glyph)} ${style(t, "muted", line)}`;
};

export class LiveGrid {
	private rows: GridRow[];
	private frame = 0;
	private visible = false;
	private timer: NodeJS.Timeout | undefined;
	private readonly write: (s: string) => void;
	private readonly tty: boolean;
	private readonly columns: () => number;

	constructor(
		rows: GridRow[],
		opts: { write?: (s: string) => void; tty?: boolean; columns?: number | (() => number) } = {},
	) {
		this.rows = rows;
		this.write = opts.write ?? ((s) => process.stderr.write(s));
		this.tty = opts.tty ?? Boolean(process.stderr.isTTY);
		const columns = opts.columns;
		this.columns =
			typeof columns === "function" ? columns : () => columns ?? process.stderr.columns ?? 120;
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
		this.clear();
	}

	private render(): void {
		if (!this.tty) return;
		this.clear();
		this.write(
			renderProgressLine(
				{ rows: this.rows },
				{ spinnerFrame: this.frame, columns: this.columns() },
			),
		);
		this.visible = true;
	}

	private clear(): void {
		if (!this.visible) return;
		this.write("\r\x1B[2K");
		this.visible = false;
	}
}
