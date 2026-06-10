import { describe, expect, it } from "vitest";
import { runOneFixStep } from "../src/commands/fix-steps.js";
import type { Diagnostic } from "../src/engines/types.js";

const diagnostic = (rule: string): Diagnostic => ({
	filePath: "src/app.ts",
	engine: "lint",
	rule,
	severity: "warning",
	message: "x",
	help: "",
	line: 1,
	column: 1,
	category: "Lint",
	fixable: false,
});

describe("runOneFixStep", () => {
	it("keeps post-fix diagnostics for final reporting", async () => {
		const remaining = diagnostic("eslint/no-unused-vars");
		let calls = 0;

		const result = await runOneFixStep(
			"Lint fixes (js/ts)",
			async () => {
				calls += 1;
				return calls === 1 ? [diagnostic("eslint/no-console"), remaining] : [remaining];
			},
			async () => {},
		);

		expect(result.resolvedIssues).toBe(1);
		expect(result.afterDiagnostics).toEqual([remaining]);
	});
});
