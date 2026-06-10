import { describe, expect, it } from "vitest";
import { highlightAislop } from "../../src/ui/brand.js";
import { createTheme } from "../../src/ui/theme.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

const theme = createTheme({ color: "truecolor", tty: true });

describe("highlightAislop", () => {
	it("colors command tokens without changing plain output", () => {
		const out = highlightAislop("Run npx aislop@latest scan, then aislop fix", theme);

		expect(strip(out)).toBe("Run npx aislop@latest scan, then aislop fix");
		expect(out).toContain("\x1B[38;2;34;197;94maislop\x1B[39m@latest");
		expect(out).toContain("\x1B[38;2;34;197;94maislop\x1B[39m fix");
	});

	it("does not color paths, URLs, or branch-like prefixes", () => {
		const text = ".aislopignore scanaislop.com github.com/scanaislop/aislop aislop/agent";
		expect(highlightAislop(text, theme)).toBe(text);
	});

	it("can keep non-brand text in a base color", () => {
		const out = highlightAislop("Run `aislop agent` locally", theme, "muted");

		expect(strip(out)).toBe("Run `aislop agent` locally");
		expect(out).toContain("\x1B[38;2;113;113;122mRun `\x1B[39m");
		expect(out).toContain("\x1B[38;2;34;197;94maislop\x1B[39m");
		expect(out).toContain("\x1B[38;2;113;113;122m agent` locally\x1B[39m");
	});
});
