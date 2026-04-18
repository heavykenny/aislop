import { describe, expect, it } from "vitest";
import { renderGridFrame } from "../../src/ui/live-grid.js";
import { createSymbols } from "../../src/ui/symbols.js";
import { createTheme } from "../../src/ui/theme.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI_RE, "");

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
						{ label: "Linting", status: "done", outcome: "warn", summary: "2 warnings", elapsedMs: 1100 },
						{ label: "Security", status: "done", outcome: "ok", summary: "0 issues", elapsedMs: 2100 },
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
		const out = strip(
			renderGridFrame({ rows: [{ label: "Linting", status: "queued" }] }, opts),
		);
		expect(out).toMatch(/• Linting\s+queued\s+—/);
	});
});
