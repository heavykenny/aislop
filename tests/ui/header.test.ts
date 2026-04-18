import { describe, expect, it } from "vitest";
import { renderHeader } from "../../src/ui/header.js";
import { createSymbols } from "../../src/ui/symbols.js";
import { createTheme } from "../../src/ui/theme.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI_RE, "");

const opts = {
	theme: createTheme({ color: "truecolor", tty: true }),
	symbols: createSymbols({ plain: false }),
};

describe("header", () => {
	it("renders brand line then command sub-header", () => {
		const out = strip(
			renderHeader(
				{ version: "0.5.0", command: "scan", context: ["my-app", "typescript", "142 files"] },
				opts,
			),
		);
		expect(out).toContain("aislop 0.5.0  ·  the quality gate for agentic coding");
		expect(out).toContain("scan  ·  my-app  ·  typescript  ·  142 files");
	});

	it("omits the sub-header when command is --bare", () => {
		const out = strip(renderHeader({ version: "0.5.0", command: "--bare", context: [] }, opts));
		expect(out).toContain("aislop 0.5.0");
		expect(out).not.toContain("--bare");
	});

	it("renders sub-header with only command when context is empty", () => {
		const out = strip(renderHeader({ version: "0.5.0", command: "init", context: [] }, opts));
		expect(out).toContain("aislop 0.5.0");
		expect(out).toMatch(/\binit\b/);
	});

	it("never contains ASCII-art banners", () => {
		const out = renderHeader({ version: "0.5.0", command: "scan", context: [] }, opts);
		expect(out).not.toMatch(/[_/\\|]{6,}/);
	});
});
