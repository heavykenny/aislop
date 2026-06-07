import { symbols as defaultSymbols, type Symbols } from "./symbols.js";
import { theme as defaultTheme, style, type Theme, type Token } from "./theme.js";
import { padEnd, stringWidth, truncate } from "./width.js";

type AgentStepStatus = "running" | "done" | "warn" | "failed" | "skipped";

interface AgentStep {
	status: AgentStepStatus;
	label: string;
}

interface AgentLogLine {
	source: string;
	line: string;
}

interface AgentTuiFile {
	filePath: string;
	updatedAt: string;
	source?: string;
}

interface AgentTuiContext {
	provider: string;
	source: string;
	directory: string;
	mode: string;
	targetScore: number;
}

interface AgentTuiOptions extends AgentTuiContext {
	write?: (s: string) => void;
	tty?: boolean;
	columns?: number | (() => number);
	rows?: number | (() => number);
	theme?: Theme;
	symbols?: Symbols;
}

interface CompleteStep {
	status: "done" | "warn" | "failed" | "skipped";
	label: string;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const ALT_SCREEN_ON = "\x1B[?1049h";
const ALT_SCREEN_OFF = "\x1B[?1049l";
const HIDE_CURSOR = "\x1B[?25l";
const SHOW_CURSOR = "\x1B[?25h";
const CLEAR_SCREEN = "\x1B[H\x1B[2J";

const stepToken = (status: AgentStepStatus): Token => {
	if (status === "running" || status === "done") return "accent";
	if (status === "warn") return "warn";
	if (status === "failed") return "danger";
	return "muted";
};

const stepGlyph = (status: AgentStepStatus, symbols: Symbols, frame: number): string => {
	if (status === "running") return SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
	if (status === "done") return symbols.stepDone;
	if (status === "warn") return symbols.warn;
	if (status === "failed") return symbols.fail;
	return symbols.neutral;
};

const cleanValue = (value: string): string => value.replace(/\s+/g, " ").trim();

const findActiveStep = (steps: AgentStep[]): AgentStep | undefined => {
	for (let i = steps.length - 1; i >= 0; i -= 1) {
		if (steps[i].status === "running") return steps[i];
	}
	return undefined;
};

const valueLines = (items: [string, string][], columns: number): string[] => {
	const labelWidth = Math.min(12, Math.max(...items.map(([label]) => stringWidth(label)), 0));
	return items
		.filter(([, value]) => value.length > 0)
		.map(([label, value]) => {
			const prefix = `${padEnd(label, labelWidth)}  `;
			return ` ${prefix}${truncate(cleanValue(value), Math.max(16, columns - stringWidth(prefix) - 2))}`;
		});
};

const orderedMetrics = (metrics: Map<string, string>): [string, string][] => {
	const order = [
		"Pass",
		"Score",
		"Target",
		"Remaining",
		"Findings",
		"Selected",
		"Changes",
		"Tools",
		"Tokens",
		"Worktree",
		"Session",
	];
	const rows: [string, string][] = [];
	for (const label of order) {
		const value = metrics.get(label);
		if (value) rows.push([label, value]);
	}
	for (const entry of metrics.entries()) {
		if (!order.includes(entry[0])) rows.push(entry);
	}
	return rows;
};

const metricLine = (metrics: Map<string, string>, columns: number): string | null => {
	const parts = orderedMetrics(metrics).map(([label, value]) => `${label}: ${cleanValue(value)}`);
	if (parts.length === 0) return null;
	const prefix = " Metrics    ";
	return `${prefix}${truncate(parts.join(" · "), Math.max(16, columns - stringWidth(prefix) - 1))}`;
};

export class AgentTui {
	private readonly write: (s: string) => void;
	private readonly tty: boolean;
	private readonly columns: () => number;
	private readonly rows: () => number;
	private readonly theme: Theme;
	private readonly symbols: Symbols;
	private readonly context: AgentTuiContext;
	private readonly metrics = new Map<string, string>();
	private readonly steps: AgentStep[] = [];
	private readonly logs: AgentLogLine[] = [];
	private files: AgentTuiFile[] = [];
	private actions: string[] = [];
	private frame = 0;
	private timer: NodeJS.Timeout | undefined;
	private active = false;
	private paused = false;

	constructor(options: AgentTuiOptions) {
		this.write = options.write ?? ((s) => process.stdout.write(s));
		this.tty = options.tty ?? Boolean(process.stdout.isTTY);
		const columns = options.columns;
		const rows = options.rows;
		this.columns =
			typeof columns === "function" ? columns : () => columns ?? process.stdout.columns ?? 100;
		this.rows = typeof rows === "function" ? rows : () => rows ?? process.stdout.rows ?? 30;
		this.theme = options.theme ?? defaultTheme;
		this.symbols = options.symbols ?? defaultSymbols;
		this.context = {
			provider: options.provider,
			source: options.source,
			directory: options.directory,
			mode: options.mode,
			targetScore: options.targetScore,
		};
		this.setMetric("Target", `${options.targetScore}/100`);
	}

	start(label: string): void {
		this.steps.push({ status: "running", label });
		if (!this.tty) return;
		this.ensureActive();
		this.startTimer();
		this.render();
	}

	complete(step: CompleteStep): void {
		const active = findActiveStep(this.steps);
		if (active) {
			active.status = step.status;
			active.label = step.label;
		} else {
			this.steps.push({ status: step.status, label: step.label });
		}
		if (!this.tty) {
			this.write(` ${stepGlyph(step.status, this.symbols, this.frame)} ${step.label}\n`);
			return;
		}
		this.render();
	}

	setActiveLabel(label: string): void {
		const active = findActiveStep(this.steps);
		if (!active) return;
		active.label = label;
		if (this.tty) this.render();
	}

	setMetric(label: string, value: string | number | null | undefined): void {
		if (value === null || value === undefined || value === "") {
			this.metrics.delete(label);
		} else {
			this.metrics.set(label, String(value));
		}
		if (this.tty) this.render();
	}

	appendLog(source: string, line: string): void {
		this.logs.push({ source, line });
		if (!this.tty) {
			this.write(`   ${source.padEnd(8)} ${line}\n`);
			return;
		}
		this.render();
	}

	setFiles(files: AgentTuiFile[]): void {
		this.files = files;
		if (this.tty) this.render();
	}

	setActions(actions: string[]): void {
		this.actions = actions.filter((action) => action.trim().length > 0);
		if (this.tty) this.render();
	}

	pause(): void {
		if (!this.tty || !this.active) return;
		this.stopTimer();
		this.write(`${SHOW_CURSOR}${ALT_SCREEN_OFF}`);
		this.paused = true;
		this.active = false;
	}

	resume(): void {
		if (!this.tty || !this.paused) return;
		this.paused = false;
		this.ensureActive();
		this.startTimer();
		this.render();
	}

	finish(opts: { footer: string }): void {
		this.stopTimer();
		if (!this.tty) {
			this.write(` ${this.symbols.railEnd} ${opts.footer}\n`);
			return;
		}
		this.render(opts.footer);
		this.deactivate();
	}

	abort(): void {
		this.stopTimer();
		if (this.tty) this.deactivate();
	}

	private ensureActive(): void {
		if (this.active || this.paused) return;
		this.write(`${ALT_SCREEN_ON}${HIDE_CURSOR}`);
		this.active = true;
	}

	private deactivate(): void {
		if (!this.active) return;
		this.write(`${SHOW_CURSOR}${ALT_SCREEN_OFF}`);
		this.active = false;
	}

	private startTimer(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			this.frame += 1;
			this.render();
		}, 100);
		this.timer.unref();
	}

	private stopTimer(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = undefined;
	}

	private render(footer?: string): void {
		if (!this.tty || !this.active || this.paused) return;
		this.write(`${CLEAR_SCREEN}${this.frameText(footer)}`);
	}

	private frameText(footer?: string): string {
		const columns = Math.max(72, Math.min(this.columns(), 120));
		const rows = Math.max(20, this.rows());
		const fileRows = Math.max(2, Math.min(5, Math.floor((rows - 14) / 2)));
		const logRows = Math.max(4, Math.min(8, rows - 16 - Math.min(this.files.length, fileRows)));
		const active = findActiveStep(this.steps);
		const lines: string[] = [];
		const title = style(this.theme, "bold", "aislop agent");
		const provider = style(this.theme, "accent", this.context.provider);
		lines.push(` ${title}  ${provider}  ${style(this.theme, "muted", this.context.mode)}`);
		lines.push("");
		lines.push(
			...valueLines(
				[
					["Status", active?.label ?? footer ?? "Finishing"],
					["Source", this.context.source],
					["Directory", this.context.directory],
				],
				columns,
			),
		);
		const metrics = metricLine(this.metrics, columns);
		if (metrics) lines.push(metrics);
		lines.push("");
		lines.push(` ${style(this.theme, "muted", "Steps")}`);
		const visibleSteps = this.steps.slice(-8);
		for (const step of visibleSteps) {
			const glyph = stepGlyph(step.status, this.symbols, this.frame);
			const token = stepToken(step.status);
			lines.push(
				` ${style(this.theme, token, glyph)} ${truncate(step.label, Math.max(12, columns - 4))}`,
			);
		}
		if (this.steps.length === 0) {
			lines.push(` ${style(this.theme, "muted", this.symbols.pending)} Waiting to start`);
		}
		lines.push("");
		lines.push(` ${style(this.theme, "muted", "Edited files")}`);
		if (this.files.length === 0) {
			lines.push(` ${style(this.theme, "muted", "No file changes yet")}`);
		} else {
			for (const file of this.files.slice(-fileRows)) {
				const time = new Date(file.updatedAt).toLocaleTimeString();
				const suffix = file.source ? ` · ${file.source}` : "";
				lines.push(
					` ${style(this.theme, "accent", this.symbols.stepDone)} ${truncate(
						`${file.filePath} · ${time}${suffix}`,
						Math.max(12, columns - 4),
					)}`,
				);
			}
			if (this.files.length > fileRows) {
				lines.push(` ${style(this.theme, "muted", `+${this.files.length - fileRows} more`)}`);
			}
		}
		lines.push("");
		lines.push(` ${style(this.theme, "muted", "Live output")}`);
		const visibleLogs = this.logs.slice(-logRows);
		if (visibleLogs.length === 0) {
			lines.push(` ${style(this.theme, "muted", "No provider output yet")}`);
		} else {
			const sourceWidth = Math.min(
				10,
				Math.max(...visibleLogs.map((log) => stringWidth(log.source)), 0),
			);
			for (const log of visibleLogs) {
				const source = padEnd(log.source, sourceWidth);
				const prefix = ` ${source}  `;
				lines.push(
					`${style(this.theme, "muted", prefix)}${style(
						this.theme,
						"dim",
						truncate(cleanValue(log.line), Math.max(12, columns - stringWidth(prefix) - 1)),
					)}`,
				);
			}
		}
		if (this.actions.length > 0) {
			lines.push("");
			lines.push(` ${style(this.theme, "muted", "Actions")}`);
			for (const action of this.actions.slice(0, 4)) {
				lines.push(
					` ${style(this.theme, "info", this.symbols.hint)} ${truncate(
						action,
						Math.max(12, columns - 4),
					)}`,
				);
			}
		}
		lines.push("");
		lines.push(
			` ${style(this.theme, "muted", footer ?? "Running locally. Transcript is written to .aislop/agent/sessions.")}`,
		);
		return `${lines.slice(0, rows).join("\n")}\n`;
	}
}
