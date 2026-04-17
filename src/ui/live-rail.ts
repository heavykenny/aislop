import { renderRailConnector, renderRailFooter, renderRailStep, type RailStep } from "./rail.js";
import { symbols as defaultSymbols, type Symbols } from "./symbols.js";
import { style, theme as defaultTheme, type Theme } from "./theme.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface LiveRailDeps {
	write?: (s: string) => void;
	tty?: boolean;
	theme?: Theme;
	symbols?: Symbols;
}

/**
 * Live, one-active-step-at-a-time rail renderer.
 *
 *   rail.start("Unused imports")
 *   // ...work...
 *   rail.complete({ status: "done", label: "Unused imports — 0 issues" })
 *   rail.start("Lint fixes (js/ts)")
 *   // ...work...
 *   rail.complete({ status: "warn", label: "Lint fixes (js/ts) — 4 remain" })
 *   rail.finish({ footer: "Done · 0 fixed · 16 remain" })
 */
export class LiveRail {
	private frame = 0;
	private activeLabel: string | null = null;
	private timer: NodeJS.Timeout | undefined;
	private readonly write: (s: string) => void;
	private readonly tty: boolean;
	private readonly theme: Theme;
	private readonly symbols: Symbols;
	private hasEmittedStep = false;

	constructor(deps: LiveRailDeps = {}) {
		this.write = deps.write ?? ((s) => process.stdout.write(s));
		this.tty = deps.tty ?? Boolean(process.stdout.isTTY);
		this.theme = deps.theme ?? defaultTheme;
		this.symbols = deps.symbols ?? defaultSymbols;
	}

	/** Begin a new step. Emits the active-line and starts animating if TTY. */
	start(label: string): void {
		this.activeLabel = label;
		if (this.tty) {
			this.drawActive();
			this.timer = setInterval(() => {
				this.frame += 1;
				this.drawActive(true);
			}, 80);
			this.timer.unref();
		}
		// In non-TTY, wait for complete() — we don't show "running" at all.
	}

	/** Resolve the active step with its final state. */
	complete(step: RailStep): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}

		if (this.tty && this.activeLabel !== null) {
			// Clear the spinner line.
			this.write("\x1B[1F\x1B[2K");
		}

		// Before the first step, emit a leading blank line so the step sits one
		// row below the header block (matches renderRail's leading "\n").
		if (!this.hasEmittedStep) {
			this.write("\n");
		} else {
			// Connector between this step and the previous one.
			this.write(renderRailConnector({ theme: this.theme, symbols: this.symbols }));
		}

		this.write(renderRailStep(step, { theme: this.theme, symbols: this.symbols }));

		this.activeLabel = null;
		this.hasEmittedStep = true;
	}

	/** Emit the footer. Call after the last complete(). */
	finish(opts: { footer: string }): void {
		// If no steps were emitted, still lead with the blank line so the
		// footer doesn't collide with the header block.
		if (!this.hasEmittedStep) {
			this.write("\n");
		}
		// Connector between the last step (or empty opening) and the └ footer.
		this.write(renderRailConnector({ theme: this.theme, symbols: this.symbols }));
		this.write(renderRailFooter(opts.footer, { theme: this.theme, symbols: this.symbols }));
	}

	/** Abort the active step without emitting a final row. Rare — use if a fatal error happens mid-step. */
	abort(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		if (this.tty && this.activeLabel !== null) {
			this.write("\x1B[1F\x1B[2K");
		}
		this.activeLabel = null;
	}

	private drawActive(redraw = false): void {
		if (!this.tty || this.activeLabel === null) return;
		if (redraw) {
			this.write("\x1B[1F\x1B[2K");
		}
		const glyph = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
		this.write(` ${style(this.theme, "info", glyph)} ${this.activeLabel}…\n`);
	}
}
