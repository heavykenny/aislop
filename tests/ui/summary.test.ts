import { describe, expect, it } from "vitest";
import { renderCleanRun, renderSummary } from "../../src/ui/summary.js";
import { createSymbols } from "../../src/ui/symbols.js";
import { createTheme } from "../../src/ui/theme.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI_RE, "");

const opts = {
	theme: createTheme({ color: "truecolor", tty: true }),
	symbols: createSymbols({ plain: false }),
};

describe("summary", () => {
	it("renders score line, counters, and second stats line", () => {
		const out = strip(
			renderSummary(
				{
					score: 89,
					label: "Healthy",
					errors: 0,
					warnings: 3,
					fixable: 2,
					files: 142,
					engines: 6,
					elapsedMs: 2300,
					nextSteps: [],
				},
				opts,
			),
		);
		expect(out).toMatch(/89 \/ 100\s+Healthy\s+0 errors  ·  3 warnings  ·  2 fixable/);
		expect(out).toMatch(/142 files  ·  6 engines  ·  2\.3s/);
	});

	it("pads the score to 10 cols so small scores align", () => {
		const out = strip(
			renderSummary(
				{
					score: 7,
					label: "Critical",
					errors: 2,
					warnings: 0,
					fixable: 0,
					files: 10,
					engines: 6,
					elapsedMs: 500,
					nextSteps: [],
				},
				opts,
			),
		);
		const line = out.split("\n").find((l) => l.includes("7 / 100")) ?? "";
		expect(line).toMatch(/7 \/ 100   Critical/);
	});

	it("renders next-steps as arrow lines", () => {
		const out = strip(
			renderSummary(
				{
					score: 89,
					label: "Healthy",
					errors: 0,
					warnings: 3,
					fixable: 2,
					files: 142,
					engines: 6,
					elapsedMs: 2300,
					nextSteps: [
						{ emphasis: "primary", text: "Run aislop fix to auto-fix 2 issues" },
						{ emphasis: "primary", text: "Run aislop fix --agent to hand off" },
					],
				},
				opts,
			),
		);
		expect(out).toContain("→ Run aislop fix to auto-fix 2 issues");
		expect(out).toContain("→ Run aislop fix --agent to hand off");
	});

	it("colors each counter individually (errors red, warnings yellow, fixable green)", () => {
		const raw = renderSummary(
			{
				score: 89,
				label: "Healthy",
				errors: 7,
				warnings: 5,
				fixable: 0,
				files: 100,
				engines: 5,
				elapsedMs: 1000,
				nextSteps: [],
			},
			opts,
		);
		// truecolor danger red = 239;68;68
		// truecolor warn yellow = 234;179;8
		// truecolor success green = 34;197;94
		expect(raw).toMatch(/\x1B\[38;2;239;68;68m7 errors\x1B\[39m/);
		expect(raw).toMatch(/\x1B\[38;2;234;179;8m5 warnings\x1B\[39m/);
		expect(raw).toMatch(/\x1B\[38;2;34;197;94m0 fixable\x1B\[39m/);
	});

	it("renders a clean-run one-liner when score is 100 and no issues", () => {
		const out = strip(renderCleanRun({ elapsedMs: 2300 }, opts));
		expect(out).toContain("✓ Clean run  ·  no issues  ·  2.3s");
	});
});
