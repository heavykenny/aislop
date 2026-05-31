import { describe, expect, it } from "vitest";
import type { EngineResult } from "../../src/engines/types.js";
import { buildJsonOutput } from "../../src/output/json.js";
import type { Coverage } from "../../src/utils/discover.js";

const scoreable: Coverage = {
	supportedFiles: 10,
	unsupportedFiles: 0,
	dominantUnsupported: null,
	scoreable: true,
};

describe("json output", () => {
	it("includes schemaVersion and cliVersion", () => {
		const results: EngineResult[] = [];
		const out = buildJsonOutput(results, { score: 100, label: "Excellent" }, 0, 10, scoreable);
		expect(out.schemaVersion).toBe("1");
		expect(typeof out.cliVersion).toBe("string");
		expect(out.cliVersion.length).toBeGreaterThan(0);
	});

	it("preserves existing top-level fields", () => {
		const results: EngineResult[] = [];
		const out = buildJsonOutput(results, { score: 89, label: "Healthy" }, 1500, 50, scoreable);
		expect(out.score).toBe(89);
		expect(out.label).toBe("Healthy");
	});

	it("withholds the score when coverage is not scoreable", () => {
		const out = buildJsonOutput([], { score: 91, label: "Healthy" }, 10, 10, {
			supportedFiles: 2,
			unsupportedFiles: 6000,
			dominantUnsupported: "C/C++",
			scoreable: false,
		});
		expect(out.score).toBeNull();
		expect(out.scoreable).toBe(false);
		expect(out.coverage.dominantUnsupported).toBe("C/C++");
	});
});
