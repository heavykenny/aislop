import { describe, expect, it } from "vitest";
import { LiveGrid, renderGridFrame, renderProgressLine } from "../../src/ui/live-grid.js";
import { createSymbols } from "../../src/ui/symbols.js";
import { createTheme } from "../../src/ui/theme.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

const opts = {
	theme: createTheme({ color: "truecolor", tty: true }),
	symbols: createSymbols({ plain: false }),
	labelWidth: 18,
	statusWidth: 12,
};

describe("live-grid", () => {
	it("aligns status text to a single fixed column across rows", () => {
		const out = strip(
			renderGridFrame(
				{
					rows: [
						{ label: "Formatting", status: "running", elapsedMs: 400 },
						{ label: "Linting", status: "running", elapsedMs: 400 },
						{ label: "Pattern Detection", status: "running", elapsedMs: 400 },
					],
				},
				opts,
			),
		);
		const lines = out.split("\n").filter(Boolean);
		const cols = lines.map((l) => l.indexOf("running")).filter((c) => c >= 0);
		expect(new Set(cols).size).toBe(1);
	});

	it("renders done rows with issue counts and elapsed", () => {
		const out = strip(
			renderGridFrame(
				{
					rows: [
						{
							label: "Linting",
							status: "done",
							outcome: "warn",
							summary: "2 warnings",
							elapsedMs: 1100,
						},
						{
							label: "Security",
							status: "done",
							outcome: "ok",
							summary: "0 issues",
							elapsedMs: 2100,
						},
					],
				},
				opts,
			),
		);
		expect(out).toMatch(/! Linting\s+2 warnings\s+1\.1s/);
		expect(out).toMatch(/✓ Security\s+0 issues\s+2\.1s/);
	});

	it("renders skipped rows with neutral glyph and em-dash elapsed", () => {
		const out = strip(
			renderGridFrame(
				{ rows: [{ label: "Architecture", status: "skipped", summary: "skipped" }] },
				opts,
			),
		);
		expect(out).toMatch(/─ Architecture\s+skipped\s+—/);
	});

	it("renders queued rows with pending glyph", () => {
		const out = strip(renderGridFrame({ rows: [{ label: "Linting", status: "queued" }] }, opts));
		expect(out).toMatch(/• Linting\s+queued\s+—/);
	});

	it("renders live progress as a compact single line", () => {
		const out = strip(
			renderProgressLine(
				{
					rows: [
						{ label: "Formatting", status: "done", summary: "0 issues" },
						{ label: "Linting", status: "running" },
						{ label: "Security", status: "queued" },
					],
				},
				{ ...opts, columns: 80 },
			),
		);

		expect(out).toContain("Scan 1/3 engines · running Linting");
		expect(out).not.toContain("\n");
	});

	it("clears the transient progress line instead of leaving a final grid", () => {
		const chunks: string[] = [];
		const grid = new LiveGrid(
			[
				{ label: "Formatting", status: "queued", key: "format" },
				{ label: "Linting", status: "queued", key: "lint" },
			],
			{
				columns: 80,
				tty: true,
				write: (chunk) => chunks.push(chunk),
			},
		);

		grid.start();
		grid.update("format", { status: "running" });
		grid.update("format", { status: "done", outcome: "ok", summary: "0 issues", elapsedMs: 20 });
		grid.stop();

		const raw = chunks.join("");
		const stripped = strip(raw);
		expect(raw).toContain("\r\x1B[2K");
		expect(raw.endsWith("\r\x1B[2K")).toBe(true);
		expect(stripped).toContain("Scan 0/2 engines · starting");
		expect(stripped).toContain("Scan 1/2 engines · finishing");
		expect(stripped).not.toMatch(/Formatting\s+queued\s+—\n.*Linting/s);
	});
});
