import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/engines/types.js";
import { renderDiagnostics } from "../src/output/terminal.js";

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
});
