import { describe, expect, it } from "vitest";
import {
	renderRail,
	renderRailConnector,
	renderRailFooter,
	renderRailStep,
} from "../../src/ui/rail.js";
import { createSymbols } from "../../src/ui/symbols.js";
import { createTheme } from "../../src/ui/theme.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI_RE, "");

const opts = {
	theme: createTheme({ color: "truecolor", tty: true }),
	symbols: createSymbols({ plain: false }),
};

describe("rail", () => {
	it("renders done/active/pending steps with rail connectors", () => {
		const out = strip(
			renderRail(
				{
					steps: [
						{ status: "done", label: "Removed 12 unused imports" },
						{ status: "done", label: "Applied 4 lint autofixes" },
						{ status: "active", label: "Formatting…" },
					],
					footer: "Done · 18 fixed · 3 remain",
				},
				opts,
			),
		);
		expect(out).toContain("◆ Removed 12 unused imports");
		expect(out).toContain("◆ Applied 4 lint autofixes");
		expect(out).toContain("◇ Formatting…");
		expect(out).toContain("└  Done · 18 fixed · 3 remain");
		expect(out.match(/│/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
	});

	it("renders inline notes under a step", () => {
		const out = strip(
			renderRail(
				{
					steps: [
						{ status: "failed", label: "ruff not found", notes: ["Install: brew install ruff"] },
					],
					footer: "Incomplete",
				},
				opts,
			),
		);
		expect(out).toContain("✗ ruff not found");
		expect(out).toContain("│ → Install: brew install ruff");
	});

	it("renders warn status with the ! glyph and warn color", () => {
		const out = strip(
			renderRail(
				{
					steps: [{ status: "warn", label: "Lint fixes (js/ts) — 4 remain" }],
					footer: "Done",
				},
				opts,
			),
		);
		expect(out).toContain("! Lint fixes (js/ts) — 4 remain");
	});

	it("renders skipped steps with neutral glyph", () => {
		const out = strip(
			renderRail(
				{ steps: [{ status: "skipped", label: "Architecture (opt-in)" }], footer: "0 steps" },
				opts,
			),
		);
		expect(out).toContain("─ Architecture (opt-in)");
	});

	it("renders a rail connector between the last step and the footer", () => {
		const out = strip(
			renderRail(
				{
					steps: [
						{ status: "done", label: "A" },
						{ status: "done", label: "B" },
					],
					footer: "Done",
				},
				opts,
			),
		);
		// 2 steps -> 1 connector between steps + 1 before footer = 2 total
		expect(out.match(/│/g)?.length ?? 0).toBe(2);
		// The line immediately before the footer should be a connector.
		const lines = out.split("\n");
		const footerIdx = lines.findIndex((l) => l.includes("└"));
		expect(footerIdx).toBeGreaterThan(0);
		expect(lines[footerIdx - 1]?.trim()).toBe("│");
	});

	it("does not add a dangling connector when there are no steps", () => {
		const out = strip(renderRail({ steps: [], footer: "Nothing to do" }, opts));
		expect(out).toContain("└  Nothing to do");
		expect(out.match(/│/g)?.length ?? 0).toBe(0);
	});
});

describe("rail helpers", () => {
	it("renderRailStep renders a single step line with trailing newline", () => {
		const out = strip(renderRailStep({ status: "done", label: "Step A" }, opts));
		expect(out).toBe(" ◆ Step A\n");
	});

	it("renderRailStep renders notes under the step", () => {
		const out = strip(
			renderRailStep(
				{ status: "failed", label: "ruff not found", notes: ["Install: brew install ruff"] },
				opts,
			),
		);
		expect(out).toContain("✗ ruff not found\n");
		expect(out).toContain("│ → Install: brew install ruff\n");
	});

	it("renderRailConnector renders a single │ line", () => {
		const out = strip(renderRailConnector(opts));
		expect(out).toBe(" │\n");
	});

	it("renderRailFooter renders the └ line", () => {
		const out = strip(renderRailFooter("Done · 1 fixed · 0 remain", opts));
		expect(out).toBe(" └  Done · 1 fixed · 0 remain\n");
	});
});
