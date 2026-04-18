import { describe, expect, it } from "vitest";
import { createLogger, renderHintLine } from "../../src/ui/logger.js";
import { createSymbols } from "../../src/ui/symbols.js";
import { createTheme } from "../../src/ui/theme.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI_RE, "");

const mkLogger = () => {
	const out: string[] = [];
	const write = (s: string) => {
		out.push(s);
	};
	const log = createLogger({
		theme: createTheme({ color: "truecolor", tty: true }),
		symbols: createSymbols({ plain: false }),
		write,
	});
	return { log, out, strip };
};

describe("logger", () => {
	it("emits a success line with the pass glyph", () => {
		const { log, out } = mkLogger();
		log.success("Formatting complete");
		expect(strip(out.join(""))).toContain("✓ Formatting complete");
	});

	it("emits an error line with the fail glyph", () => {
		const { log, out } = mkLogger();
		log.error("Config not found");
		expect(strip(out.join(""))).toContain("✗ Config not found");
	});

	it("emits a warn line with the warn glyph", () => {
		const { log, out } = mkLogger();
		log.warn("Deprecated flag");
		expect(strip(out.join(""))).toContain("! Deprecated flag");
	});

	it("emits a hint line with the arrow glyph", () => {
		const { log, out } = mkLogger();
		log.hint("Run aislop init");
		expect(strip(out.join(""))).toContain("→ Run aislop init");
	});

	it("emits a blank line on break()", () => {
		const { log, out } = mkLogger();
		log.break();
		expect(out.join("")).toBe("\n");
	});

	it("emits muted text when asked", () => {
		const { log, out } = mkLogger();
		log.muted("142 files");
		expect(strip(out.join(""))).toContain("142 files");
	});

	it("writes nothing extra when log.raw is used", () => {
		const { log, out } = mkLogger();
		log.raw("hello");
		expect(out.join("")).toBe("hello\n");
	});
});

describe("renderHintLine", () => {
	it("renders an accent-green arrow followed by the hint text", () => {
		const line = renderHintLine("Run npx aislop scan", {
			theme: createTheme({ color: "truecolor", tty: true }),
			symbols: createSymbols({ plain: false }),
		});
		expect(strip(line)).toBe(" → Run npx aislop scan\n");
		// Accent-green truecolor escape must appear around the arrow.
		expect(line).toContain("\x1B[38;2;34;197;94m→\x1B[39m");
	});

	it("falls back to defaults when deps are not provided", () => {
		const line = renderHintLine("Hello");
		expect(strip(line).endsWith("Hello\n")).toBe(true);
	});
});
