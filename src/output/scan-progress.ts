import type { EngineName, EngineResult } from "../engines/types.js";
import { highlighter } from "../utils/highlighter.js";
import { getEngineLabel } from "./engine-info.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type EngineScanStatus = "pending" | "running" | "done" | "skipped";

export interface EngineScanState {
	engine: EngineName;
	status: EngineScanStatus;
	result?: EngineResult;
}

const shouldRenderLiveScanProgress = (): boolean =>
	Boolean(process.stderr.isTTY) && process.env.CI !== "true" && process.env.CI !== "1";

const formatElapsed = (elapsedMs: number): string =>
	elapsedMs < 1000 ? `${Math.round(elapsedMs)}ms` : `${(elapsedMs / 1000).toFixed(1)}s`;

const truncateText = (text: string, maxLength = 52): string =>
	text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;

const getIssueSummary = (result: EngineResult): string => {
	const errors = result.diagnostics.filter((d) => d.severity === "error").length;
	const warnings = result.diagnostics.filter((d) => d.severity === "warning").length;

	if (errors === 0 && warnings === 0) {
		return `Done (0 issues, ${formatElapsed(result.elapsed)})`;
	}

	const parts: string[] = [];
	if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
	if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);

	return `Done (${parts.join(", ")}, ${formatElapsed(result.elapsed)})`;
};

const getStatusParts = (
	state: EngineScanState,
	frameIndex: number,
): { icon: string; detail: string } => {
	if (state.status === "running") {
		return {
			icon: highlighter.info(SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]),
			detail: highlighter.info("Running"),
		};
	}

	if (state.status === "done") {
		const result = state.result;
		if (!result) {
			return {
				icon: highlighter.success("✓"),
				detail: highlighter.dim("Done"),
			};
		}

		const hasErrors = result.diagnostics.some((d) => d.severity === "error");
		const hasWarnings = result.diagnostics.some((d) => d.severity === "warning");

		let icon = highlighter.success("✓");
		if (hasErrors) {
			icon = highlighter.error("✗");
		} else if (hasWarnings) {
			icon = highlighter.warn("!");
		}

		return {
			icon,
			detail: highlighter.dim(getIssueSummary(result)),
		};
	}

	if (state.status === "skipped") {
		const reason =
			state.result?.skipReason?.split("\n").find((line) => line.trim().length > 0) ?? "Skipped";
		return {
			icon: highlighter.warn("!"),
			detail: highlighter.dim(`Skipped (${truncateText(reason)})`),
		};
	}

	return {
		icon: highlighter.dim("○"),
		detail: highlighter.dim("Waiting"),
	};
};

export const renderScanProgressBlock = (states: EngineScanState[], frameIndex: number): string => {
	if (states.length === 0) {
		return `  ${highlighter.bold("Engines 0/0")} ${highlighter.dim("nothing to run")}\n`;
	}

	const completedCount = states.filter(
		(state) => state.status === "done" || state.status === "skipped",
	).length;
	const runningCount = states.filter((state) => state.status === "running").length;
	const labelWidth = Math.max(...states.map((state) => getEngineLabel(state.engine).length));

	const headingStatus =
		completedCount === states.length
			? highlighter.dim("complete")
			: runningCount > 0
				? highlighter.dim(`${runningCount} running`)
				: highlighter.dim("starting");

	const lines = [
		`  ${highlighter.bold(`Engines ${completedCount}/${states.length}`)} ${headingStatus}`,
		...states.map((state) => {
			const label = getEngineLabel(state.engine).padEnd(labelWidth, " ");
			const { icon, detail } = getStatusParts(state, frameIndex);
			return `    ${icon} ${label}  ${detail}`;
		}),
	];

	return `${lines.join("\n")}\n`;
};

const clearRenderedLines = (lineCount: number): void => {
	if (lineCount === 0) return;

	process.stderr.write(`\u001B[${lineCount}F`);
	for (let index = 0; index < lineCount; index += 1) {
		process.stderr.write("\u001B[2K");
		if (index < lineCount - 1) {
			process.stderr.write("\u001B[1E");
		}
	}
	if (lineCount > 1) {
		process.stderr.write(`\u001B[${lineCount - 1}F`);
	}
};

export class ScanProgressRenderer {
	private readonly states: EngineScanState[];
	private previousLineCount = 0;
	private frameIndex = 0;
	private timer: NodeJS.Timeout | undefined;

	constructor(engines: EngineName[]) {
		this.states = engines.map((engine) => ({
			engine,
			status: "pending",
		}));
	}

	start(): void {
		if (!shouldRenderLiveScanProgress()) return;

		this.render();
		this.timer = setInterval(() => {
			this.frameIndex += 1;
			this.render();
		}, 100);
		this.timer.unref();
	}

	markStarted(engine: EngineName): void {
		const state = this.states.find((entry) => entry.engine === engine);
		if (!state) return;

		state.status = "running";
		this.render();
	}

	markComplete(result: EngineResult): void {
		const state = this.states.find((entry) => entry.engine === result.engine);
		if (!state) return;

		state.status = result.skipped ? "skipped" : "done";
		state.result = result;
		this.render();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}

		if (!shouldRenderLiveScanProgress()) return;
		this.render();
	}

	private render(): void {
		if (!shouldRenderLiveScanProgress()) return;

		if (this.previousLineCount > 0) {
			clearRenderedLines(this.previousLineCount);
		}

		const output = renderScanProgressBlock(this.states, this.frameIndex);
		process.stderr.write(output);
		this.previousLineCount = output.split("\n").length - 1;
	}
}
