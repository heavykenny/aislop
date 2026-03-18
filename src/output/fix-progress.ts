import { highlighter } from "../utils/highlighter.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type FixStepStatus = "pending" | "running" | "done" | "failed";

export interface FixStepResult {
	name: string;
	beforeIssues: number;
	afterIssues: number;
	resolvedIssues: number;
	beforeFiles: number;
	failed: boolean;
	elapsedMs: number;
}

interface FixStepState {
	name: string;
	status: FixStepStatus;
	result?: FixStepResult;
}

const shouldRenderLive = (): boolean =>
	Boolean(process.stderr.isTTY) && process.env.CI !== "true" && process.env.CI !== "1";

const formatElapsed = (elapsedMs: number): string =>
	elapsedMs < 1000 ? `${Math.round(elapsedMs)}ms` : `${(elapsedMs / 1000).toFixed(1)}s`;

const getStepSummary = (result: FixStepResult): string => {
	if (result.failed) {
		return `Failed (${result.afterIssues} remain)`;
	}
	if (result.beforeIssues === 0) {
		return `0 issues, ${formatElapsed(result.elapsedMs)}`;
	}
	if (result.afterIssues === 0) {
		return `${result.resolvedIssues} resolved, ${formatElapsed(result.elapsedMs)}`;
	}
	if (result.resolvedIssues > 0) {
		return `${result.resolvedIssues} resolved, ${result.afterIssues} remaining, ${formatElapsed(result.elapsedMs)}`;
	}
	return `no changes, ${result.afterIssues} issue${result.afterIssues === 1 ? "" : "s"}, ${formatElapsed(result.elapsedMs)}`;
};

const getStatusParts = (
	state: FixStepState,
	frameIndex: number,
): { icon: string; detail: string } => {
	if (state.status === "running") {
		return {
			icon: highlighter.info(SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]),
			detail: highlighter.info("Running"),
		};
	}

	if (state.status === "done" && state.result) {
		const hasRemaining = state.result.afterIssues > 0;
		const icon = hasRemaining ? highlighter.warn("!") : highlighter.success("✓");
		return {
			icon,
			detail: highlighter.dim(`Done (${getStepSummary(state.result)})`),
		};
	}

	if (state.status === "failed" && state.result) {
		return {
			icon: highlighter.error("✗"),
			detail: highlighter.dim(`Failed (${getStepSummary(state.result)})`),
		};
	}

	return {
		icon: highlighter.dim("○"),
		detail: highlighter.dim("Waiting"),
	};
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

const renderFixProgressBlock = (states: FixStepState[], frameIndex: number): string => {
	if (states.length === 0) {
		return `  ${highlighter.bold("Fixes 0/0")} ${highlighter.dim("nothing to run")}\n`;
	}

	const completedCount = states.filter((s) => s.status === "done" || s.status === "failed").length;
	const runningCount = states.filter((s) => s.status === "running").length;
	const labelWidth = Math.max(...states.map((s) => s.name.length));

	const headingStatus =
		completedCount === states.length
			? highlighter.dim("complete")
			: runningCount > 0
				? highlighter.dim(`${runningCount} running`)
				: highlighter.dim("starting");

	const lines = [
		`  ${highlighter.bold(`Fixes ${completedCount}/${states.length}`)} ${headingStatus}`,
		...states.map((state) => {
			const label = state.name.padEnd(labelWidth, " ");
			const { icon, detail } = getStatusParts(state, frameIndex);
			return `    ${icon} ${label}  ${detail}`;
		}),
	];

	return `${lines.join("\n")}\n`;
};

export class FixProgressRenderer {
	private readonly states: FixStepState[];
	private previousLineCount = 0;
	private frameIndex = 0;
	private timer: NodeJS.Timeout | undefined;
	private readonly live: boolean;

	constructor(stepNames: string[]) {
		this.states = stepNames.map((name) => ({ name, status: "pending" }));
		this.live = shouldRenderLive();
	}

	isLive(): boolean {
		return this.live;
	}

	start(): void {
		if (!this.live) return;

		this.render();
		this.timer = setInterval(() => {
			this.frameIndex += 1;
			this.render();
		}, 100);
		this.timer.unref();
	}

	markStarted(name: string): void {
		const state = this.states.find((s) => s.name === name);
		if (!state) return;

		state.status = "running";
		this.render();
	}

	markComplete(name: string, result: FixStepResult): void {
		const state = this.states.find((s) => s.name === name);
		if (!state) return;

		state.status = result.failed ? "failed" : "done";
		state.result = result;
		this.render();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}

		if (!this.live) return;
		this.render();
	}

	private render(): void {
		if (!this.live) return;

		if (this.previousLineCount > 0) {
			clearRenderedLines(this.previousLineCount);
		}

		const output = renderFixProgressBlock(this.states, this.frameIndex);
		process.stderr.write(output);
		this.previousLineCount = output.split("\n").length - 1;
	}
}
