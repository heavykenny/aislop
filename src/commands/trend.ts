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

const formatDate = (timestamp: string): string => {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return timestamp;
	return date.toISOString().slice(0, 16).replace("T", " ");
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
	printBrand?: boolean;
}

export const buildTrendRender = (input: BuildTrendRenderInput): string => {
	const header = renderHeader({
		version: APP_VERSION,
		command: "trend",
		context: [],
		brand: input.printBrand !== false,
	});

	if (input.records.length === 0) {
		return `${header}\n  ${style(
			theme,
			"muted",
			"No score history yet. Run a scan to start tracking trends.",
		)}\n`;
	}

	const limit = input.limit ?? DEFAULT_LIMIT;
	const recent = input.records.slice(-limit);
	const scores = recent.map((r) => r.score);

	const lines: string[] = [header];
	lines.push(
		`  ${style(theme, "dim", padEnd("Date", 18))}${style(theme, "dim", padEnd("Score", 8))}${style(
			theme,
			"dim",
			padEnd("Δ", 6),
		)}${style(theme, "dim", padEnd("Err", 6))}${style(theme, "dim", "Warn")}`,
	);
	recent.forEach((record, index) => {
		const previous = index > 0 ? recent[index - 1]?.score : undefined;
		lines.push(
			`  ${padEnd(formatDate(record.timestamp), 18)}${padEnd(String(record.score), 8)}${padEnd(
				delta(record.score, previous),
				6,
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
