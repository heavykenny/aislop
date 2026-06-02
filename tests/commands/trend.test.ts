import { describe, expect, it } from "vitest";
import { buildTrendRender, renderSparkline } from "../../src/commands/trend.js";
import type { HistoryRecord } from "../../src/utils/history.js";
import { stripAnsi as plain } from "../helpers/ansi.js";

const createRecord = (overrides: Partial<HistoryRecord> = {}): HistoryRecord => ({
	timestamp: "2026-05-29T10:00:00.000Z",
	score: 90,
	errors: 0,
	warnings: 2,
	files: 50,
	cliVersion: "0.9.4",
	...overrides,
});

describe("renderSparkline", () => {
	it("returns empty string for no scores", () => {
		expect(renderSparkline([])).toBe("");
	});

	it("maps a flat series to the top tick", () => {
		expect(renderSparkline([80, 80, 80])).toBe("███");
	});

	it("maps low and high scores to low and high ticks", () => {
		const spark = renderSparkline([10, 100]);
		expect(spark[0]).toBe("▁");
		expect(spark[1]).toBe("█");
	});
});

describe("buildTrendRender", () => {
	it("shows an empty-state message when there is no history", () => {
		const output = plain(buildTrendRender({ records: [], printBrand: false }));
		expect(output).toContain("No score history yet");
	});

	it("renders a table row and sparkline for recorded scans", () => {
		const records = [
			createRecord({ score: 70 }),
			createRecord({ score: 85, timestamp: "2026-05-29T11:00:00.000Z" }),
		];
		const output = plain(buildTrendRender({ records, printBrand: false }));
		expect(output).toContain("70");
		expect(output).toContain("85");
		expect(output).toContain("+15");
		expect(output).toContain("2 run(s), latest score 85");
	});

	it("respects the limit by keeping only the most recent runs", () => {
		const records = Array.from({ length: 30 }, (_, i) => createRecord({ score: i }));
		const output = plain(buildTrendRender({ records, limit: 5, printBrand: false }));
		expect(output).toContain("5 run(s), latest score 29");
	});
});
