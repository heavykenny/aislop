import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/engines/types.js";
import { countRenderedLines, shouldPageOutput } from "../src/output/pager.js";
import { renderDiagnostics, renderSummary } from "../src/output/terminal.js";

const createDiagnostic = (
	overrides: Partial<Diagnostic> = {},
): Diagnostic => ({
	filePath: "src/example.ts",
	engine: "lint",
	rule: "lint/example",
	severity: "warning",
	message: "Example issue",
	help: "Helpful guidance",
	line: 1,
	column: 1,
	category: "style",
	fixable: false,
	...overrides,
});

describe("pager output", () => {
	it("counts wrapped lines after removing ANSI codes", () => {
		const colored = "\u001B[31mabcdef\u001B[39m";
		expect(countRenderedLines(colored, 3)).toBe(2);
	});

	it("pages only when output exceeds the terminal height in a TTY", () => {
		const text = ["one", "two", "three", "four", "five"].join("\n");

		expect(
			shouldPageOutput(text, {
				stdinIsTTY: true,
				stdoutIsTTY: true,
				rows: 4,
				columns: 80,
			}),
		).toBe(true);

		expect(
			shouldPageOutput(text, {
				stdinIsTTY: false,
				stdoutIsTTY: true,
				rows: 4,
				columns: 80,
			}),
		).toBe(false);
	});
});

describe("terminal rendering", () => {
	it("truncates repeated locations in non-verbose mode", () => {
		const diagnostics = Array.from({ length: 5 }, (_, index) =>
			createDiagnostic({
				filePath: `src/example-${index + 1}.ts`,
				line: index + 1,
			}),
		);

		const output = renderDiagnostics(diagnostics, false);

		expect(output).toContain("Example issue (5)");
		expect(output).toContain("+2 more location(s), use -d for full list");
		expect(output).not.toContain("src/example-5.ts:5:1");
	});

	it("shows every location in verbose mode", () => {
		const diagnostics = Array.from({ length: 4 }, (_, index) =>
			createDiagnostic({
				filePath: `src/example-${index + 1}.ts`,
				line: index + 1,
			}),
		);

		const output = renderDiagnostics(diagnostics, true);

		expect(output).toContain("src/example-4.ts:4:1");
		expect(output).not.toContain("more location(s)");
	});

	it("renders a summary block with score and counts", () => {
		const diagnostics = [
			createDiagnostic({ severity: "error", fixable: true }),
			createDiagnostic({
				filePath: "src/other.ts",
				message: "Second issue",
				help: "Another hint",
			}),
		];

		const output = renderSummary(
			diagnostics,
			{ score: 82, label: "Needs Work" },
			1520,
			17,
			{ good: 90, ok: 75 },
		);

		expect(output).toContain("Summary");
		expect(output).toContain("82/100");
		expect(output).toContain("1 error");
		expect(output).toContain("1 warning");
		expect(output).toContain("Auto-fixable: 1");
		expect(output).toContain("Files: 17");
		expect(output).toContain("Time: 1.5s");
	});
});
