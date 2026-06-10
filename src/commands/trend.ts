import { renderHeader } from "../ui/header.js";
import { renderHintLine } from "../ui/logger.js";
import { style, theme } from "../ui/theme.js";
import { padEnd } from "../ui/width.js";
import { type HistoryRecord, readHistory } from "../utils/history.js";
import { APP_VERSION } from "../version.js";

const SPARK_TICKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const DEFAULT_LIMIT = 20;

export const renderSparkline = (scores: number[]): string => {
	if (scores.length === 0) return "";
	const min = Math.min(...scores);
	const max = Math.max(...scores);
	const span = max - min;
	return scores
		.map((score) => {
			if (span === 0) return SPARK_TICKS[SPARK_TICKS.length - 1];
			const ratio = (score - min) / span;
			const index = Math.round(ratio * (SPARK_TICKS.length - 1));
			return SPARK_TICKS[index];
		})
		.join("");
};

const relativePhrase = (count: number, unit: string, future: boolean): string => {
	const suffix = count === 1 ? unit : `${unit}s`;
	const phrase = `${count} ${suffix}`;
	return future ? `in ${phrase}` : `${phrase} ago`;
};

export const formatRelativeTime = (timestamp: string, now = new Date()): string => {
	const date = new Date(timestamp);
	const nowMs = now.getTime();
	if (Number.isNaN(date.getTime()) || Number.isNaN(nowMs)) return timestamp;

	const diffMs = nowMs - date.getTime();
	const future = diffMs < 0;
	const absMs = Math.abs(diffMs);
	if (absMs < 45_000) return "just now";

	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	const week = 7 * day;
	const month = 30 * day;
	const year = 365 * day;

	if (absMs < hour)
		return relativePhrase(Math.max(1, Math.round(absMs / minute)), "minute", future);
	if (absMs < day) return relativePhrase(Math.max(1, Math.round(absMs / hour)), "hour", future);
	if (absMs < week) return relativePhrase(Math.max(1, Math.round(absMs / day)), "day", future);
	if (absMs < month) return relativePhrase(Math.max(1, Math.round(absMs / week)), "week", future);
	if (absMs < year) return relativePhrase(Math.max(1, Math.round(absMs / month)), "month", future);
	return relativePhrase(Math.max(1, Math.round(absMs / year)), "year", future);
};

const delta = (current: number, previous: number | undefined): string => {
	if (previous === undefined) return "";
	const diff = current - previous;
	if (diff > 0) return style(theme, "success", `+${diff}`);
	if (diff < 0) return style(theme, "danger", `${diff}`);
	return style(theme, "muted", "0");
};

interface BuildTrendRenderInput {
	records: HistoryRecord[];
	limit?: number;
	now?: Date;
	printBrand?: boolean;
}

export const buildTrendRender = (input: BuildTrendRenderInput): string => {
	const header = renderHeader({
		version: APP_VERSION,
		command: "Score history",
		context: [],
		brand: input.printBrand !== false,
	});

	if (input.records.length === 0) {
		return `${header.trimEnd()}\n\n  ${style(
			theme,
			"muted",
			"No score history yet. Run a scan to start tracking trends.",
		)}\n`;
	}

	const limit = input.limit ?? DEFAULT_LIMIT;
	const recent = input.records.slice(-limit);
	const scores = recent.map((r) => r.score);
	const whenLabels = recent.map((record) => formatRelativeTime(record.timestamp, input.now));
	const whenWidth = Math.max(14, ...whenLabels.map((label) => label.length)) + 2;

	const lines: string[] = [header.trimEnd(), ""];
	lines.push(
		`  ${style(theme, "dim", padEnd("When", whenWidth))}${style(theme, "dim", padEnd("Score", 8))}${style(
			theme,
			"dim",
			padEnd("Change", 8),
		)}${style(theme, "dim", padEnd("Err", 6))}${style(theme, "dim", "Warn")}`,
	);
	recent.forEach((record, index) => {
		const previous = index > 0 ? recent[index - 1]?.score : undefined;
		lines.push(
			`  ${padEnd(whenLabels[index] ?? "", whenWidth)}${padEnd(String(record.score), 8)}${padEnd(
				delta(record.score, previous),
				8,
			)}${padEnd(String(record.errors), 6)}${record.warnings}`,
		);
	});

	const latest = recent[recent.length - 1];
	lines.push("");
	lines.push(`  ${style(theme, "accent", renderSparkline(scores))}`);
	lines.push(
		`  ${style(theme, "muted", `${recent.length} run(s), latest score ${latest?.score}`)}`,
	);
	lines.push(renderHintLine("Run aislop scan to add a new data point").trimEnd());

	return `${lines.join("\n")}\n`;
};

export const trendCommand = (directory: string, limit?: number): void => {
	const records = readHistory(directory);
	process.stdout.write(buildTrendRender({ records, limit }));
};
