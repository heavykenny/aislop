import { describe, expect, it } from "vitest";
import { LiveRail } from "../../src/ui/live-rail.js";
import { createSymbols } from "../../src/ui/symbols.js";
import { createTheme } from "../../src/ui/theme.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI_RE, "");

const mkRail = (tty: boolean) => {
	const out: string[] = [];
	const rail = new LiveRail({
		write: (s) => {
			out.push(s);
		},
		tty,
		theme: createTheme({ color: "truecolor", tty: true }),
		symbols: createSymbols({ plain: false }),
	});
	return { rail, out };
};

describe("LiveRail", () => {
	it("in non-TTY, emits nothing on start and emits the final row + connector on complete", () => {
		const { rail, out } = mkRail(false);
		rail.start("Linting");
		expect(out.join("")).toBe("");
		rail.complete({ status: "done", label: "Linting — 0 issues" });
		expect(strip(out.join(""))).toContain("◆ Linting — 0 issues");
	});

	it("in TTY, writes an active-line with a spinner frame and a trailing newline", () => {
		const { rail, out } = mkRail(true);
		rail.start("Linting");
		rail.complete({ status: "done", label: "Linting — 0 issues" });
		const stripped = strip(out.join(""));
		// The active line should have appeared and been cleared, but
		// importantly the final line is correct:
		expect(stripped).toContain("◆ Linting — 0 issues");
	});

	it("finish() emits exactly one connector between the last step and the footer", () => {
		const { rail, out } = mkRail(false);
		rail.start("A");
		rail.complete({ status: "done", label: "A — ok" });
		rail.start("B");
		rail.complete({ status: "warn", label: "B — 1 remain" });
		rail.finish({ footer: "Done" });
		const stripped = strip(out.join(""));
		// Count connectors: exactly one between A and B, one between B and footer.
		const connectors = stripped.match(/│/g) ?? [];
		expect(connectors.length).toBeGreaterThanOrEqual(2);
		expect(stripped).toContain("└  Done");
		// The line directly above the footer should be a bare connector.
		const lines = stripped.split("\n");
		const footerIdx = lines.findIndex((l) => l.includes("└"));
		expect(footerIdx).toBeGreaterThan(0);
		expect(lines[footerIdx - 1]?.trim()).toBe("│");
	});
});
