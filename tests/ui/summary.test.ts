import { describe, expect, it } from "vitest";
import { renderCleanRun, renderSummary, renderTeamCta } from "../../src/ui/summary.js";
import { createSymbols } from "../../src/ui/symbols.js";
import { createTheme } from "../../src/ui/theme.js";
import { ANSI_ESCAPE, stripAnsi as strip } from "../helpers/ansi.js";

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
		expect(out).toMatch(/89 \/ 100\s+Healthy\s+0 errors {2}· {2}3 warnings {2}· {2}2 fixable/);
		expect(out).toMatch(/142 files {2}· {2}6 engines {2}· {2}2\.3s/);
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
		expect(line).toMatch(/7 \/ 100 {3}Critical/);
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

	it("renders command next-steps as an aligned action plan", () => {
		const out = strip(
			renderSummary(
				{
					score: 42,
					label: "Critical",
					errors: 4,
					warnings: 8,
					fixable: 3,
					files: 100,
					engines: 5,
					elapsedMs: 1000,
					nextSteps: [
						{
							emphasis: "primary",
							label: "Agent",
							command: "aislop agent",
							detail: "run a local worktree repair session",
						},
						{
							emphasis: "primary",
							label: "Auto-fix",
							command: "aislop fix",
							detail: "auto-fix 3 issues",
						},
					],
				},
				opts,
			),
		);
		expect(out).toContain("Agent repair plan");
		expect(out).toMatch(/Agent\s+aislop agent\s+run a local worktree repair session/);
		expect(out).toMatch(/Auto-fix\s+aislop fix\s+auto-fix 3 issues/);
	});

	it("renders top findings as a labeled table", () => {
		const out = strip(
			renderSummary(
				{
					score: 42,
					label: "Critical",
					errors: 4,
					warnings: 8,
					fixable: 3,
					files: 100,
					engines: 5,
					elapsedMs: 1000,
					nextSteps: [],
					breakdown: {
						rows: [
							{
								rule: "ai-slop/trivial-comment",
								errors: 0,
								warnings: 8,
								info: 0,
								fixable: 8,
							},
							{
								rule: "security/vulnerable-dependency",
								errors: 4,
								warnings: 0,
								info: 0,
								fixable: 0,
							},
						],
						hiddenRules: 0,
						hiddenErrors: 0,
						hiddenWarnings: 0,
					},
				},
				opts,
			),
		);
		expect(out).toContain("Top findings");
		expect(out).toMatch(/#\s+Finding\s+Rule\s+Status/);
		expect(out).toMatch(
			/8\s+Trivial restating comment\s+ai-slop\/trivial-comment\s+8 warn\s+·\s+8 fixable/,
		);
		expect(out).not.toContain("(ai-slop/trivial-comment)");
	});

	it("renders the verdict mix when finding assessment is provided", () => {
		const out = strip(
			renderSummary(
				{
					score: 42,
					label: "Critical",
					errors: 2,
					warnings: 6,
					fixable: 0,
					files: 100,
					engines: 5,
					elapsedMs: 1000,
					nextSteps: [],
					findingAssessment: {
						rows: [
							{
								kind: "confirmed-defect",
								label: "confirmed defects",
								count: 2,
								errors: 2,
								warnings: 0,
								info: 0,
								fixable: 0,
							},
							{
								kind: "conservative-security",
								label: "conservative security",
								count: 6,
								errors: 6,
								warnings: 0,
								info: 0,
								fixable: 0,
							},
						],
						byKind: {
							"confirmed-defect": 2,
							"conservative-security": 6,
							"style-policy": 0,
							"ai-slop-indicator": 0,
						},
						byConfidence: { high: 2, medium: 6, low: 0 },
					},
				},
				opts,
			),
		);
		expect(out).toContain("Verdict mix:");
		expect(out).toContain("2 confirmed defects");
		expect(out).toContain("6 conservative security");
		expect(out).toContain("2 high-confidence, 6 medium-confidence");
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
		expect(raw).toContain(`${ANSI_ESCAPE}[38;2;239;68;68m7 errors${ANSI_ESCAPE}[39m`);
		expect(raw).toContain(`${ANSI_ESCAPE}[38;2;234;179;8m5 warnings${ANSI_ESCAPE}[39m`);
		expect(raw).toContain(`${ANSI_ESCAPE}[38;2;34;197;94m0 fixable${ANSI_ESCAPE}[39m`);
	});

	it("renders a clean-run one-liner when score is 100 and no issues", () => {
		const out = strip(renderCleanRun({ elapsedMs: 2300 }, opts));
		expect(out).toContain("✓ Clean run  ·  no issues  ·  2.3s");
	});

	it("renders the team CTA with a visible https URL", () => {
		const out = strip(renderTeamCta(opts));
		expect(out).toContain("Gate every PR free at https://scanaislop.com");
	});
});
