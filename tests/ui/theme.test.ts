import { describe, expect, it } from "vitest";
import { createTheme, style } from "../../src/ui/theme.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
const stripAnsi = (s: string) => s.replace(ANSI_RE, "");

describe("theme", () => {
	it("wraps text with the accent color when color is enabled", () => {
		const theme = createTheme({ color: "truecolor", tty: true });
		const out = style(theme, "accent", "aislop");
		expect(out).not.toBe("aislop");
		expect(stripAnsi(out)).toBe("aislop");
	});

	it("emits no ANSI when color is disabled", () => {
		const theme = createTheme({ color: "none", tty: false });
		expect(style(theme, "accent", "aislop")).toBe("aislop");
	});

	it("respects NO_COLOR", () => {
		const theme = createTheme({ color: "auto", tty: true, env: { NO_COLOR: "1" } });
		expect(style(theme, "danger", "boom")).toBe("boom");
	});

	it("respects FORCE_COLOR=1 even without a TTY", () => {
		const theme = createTheme({ color: "auto", tty: false, env: { FORCE_COLOR: "1" } });
		const out = style(theme, "accent", "x");
		expect(out).not.toBe("x");
	});

	it("falls back to 256-color when truecolor is unavailable", () => {
		const theme = createTheme({ color: "256", tty: true });
		const out = style(theme, "accent", "x");
		expect(out).toMatch(/\x1B\[38;5;10m/);
	});

	it("exposes every design token", () => {
		const theme = createTheme({ color: "truecolor", tty: true });
		for (const token of [
			"accent",
			"accentDim",
			"fg",
			"muted",
			"danger",
			"warn",
			"info",
			"success",
			"bold",
			"dim",
		] as const) {
			expect(style(theme, token, "x")).toBeTypeOf("string");
		}
	});
});
