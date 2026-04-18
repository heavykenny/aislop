import { describe, expect, it } from "vitest";
import { buildJsonOutput } from "../../src/output/json.js";
import type { EngineResult } from "../../src/engines/types.js";

describe("json output", () => {
	it("includes schemaVersion and cliVersion", () => {
		const results: EngineResult[] = [];
		const out = buildJsonOutput(results, { score: 100, label: "Excellent" }, 0, 10);
		expect(out.schemaVersion).toBe("1");
		expect(typeof out.cliVersion).toBe("string");
		expect(out.cliVersion.length).toBeGreaterThan(0);
	});

	it("preserves existing top-level fields", () => {
		const results: EngineResult[] = [];
		const out = buildJsonOutput(results, { score: 89, label: "Healthy" }, 1500, 50);
		expect(out.score).toBe(89);
		expect(out.label).toBe("Healthy");
	});
});
