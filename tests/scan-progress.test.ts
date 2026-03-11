import { describe, expect, it } from "vitest";
import type { EngineResult } from "../src/engines/types.js";
import {
	renderScanProgressBlock,
	type EngineScanState,
} from "../src/output/scan-progress.js";

const createResult = (
	engine: EngineResult["engine"],
	overrides: Partial<EngineResult> = {},
): EngineResult => ({
	engine,
	diagnostics: [],
	elapsed: 1250,
	skipped: false,
	...overrides,
});

describe("scan progress rendering", () => {
	it("renders stable rows for waiting, running, done, and skipped states", () => {
		const states: EngineScanState[] = [
			{ engine: "format", status: "pending" },
			{ engine: "lint", status: "running", startedAtMs: 1000 },
			{
				engine: "security",
				status: "done",
				result: createResult("security", {
					diagnostics: [
						{
							filePath: "src/a.ts",
							engine: "security",
							rule: "security/eval",
							severity: "error",
							message: "bad",
							help: "fix it",
							line: 1,
							column: 1,
							category: "Security",
							fixable: false,
						},
					],
				}),
			},
			{
				engine: "architecture",
				status: "skipped",
				result: createResult("architecture", {
					skipped: true,
					skipReason: "No rules configured for this project",
				}),
			},
		];

		const output = renderScanProgressBlock(states, 0);

		expect(output).toContain("Engines 2/4");
		expect(output).toContain("Formatting");
		expect(output).toContain("Waiting");
		expect(output).toContain("Linting");
		expect(output).toContain("Running");
		expect(output).toContain("Security");
		expect(output).toContain("Done (1 error, 1.3s)");
		expect(output).toContain("Architecture");
		expect(output).toContain("Skipped (No rules configured for this project)");
	});

	it("renders an empty state when no engines are enabled", () => {
		const output = renderScanProgressBlock([], 0);
		expect(output).toContain("Engines 0/0");
		expect(output).toContain("nothing to run");
	});
});
