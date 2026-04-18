import { describe, expect, it } from "vitest";
import { renderError } from "../../src/ui/error.js";
import { createSymbols } from "../../src/ui/symbols.js";
import { createTheme } from "../../src/ui/theme.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI_RE, "");

const opts = {
	theme: createTheme({ color: "truecolor", tty: true }),
	symbols: createSymbols({ plain: false }),
};

describe("error", () => {
	it("renders message, cause, hints, and docs on separate lines", () => {
		const out = strip(
			renderError(
				{
					message: "Config not found",
					cause: "Looked in: ./.aislop/config.yml",
					hints: ["Run aislop init to create one"],
					docsUrl: "https://aislop.dev/docs/config",
				},
				opts,
			),
		);
		expect(out).toContain("✗ Config not found");
		expect(out).toContain("│ Looked in: ./.aislop/config.yml");
		expect(out).toContain("→ Run aislop init to create one");
		expect(out).toContain("→ Docs: https://aislop.dev/docs/config");
	});

	it("omits cause, hints, and docs when not provided", () => {
		const out = strip(renderError({ message: "Boom" }, opts));
		expect(out).toContain("✗ Boom");
		expect(out).not.toContain("│");
		expect(out).not.toContain("→");
	});
});
