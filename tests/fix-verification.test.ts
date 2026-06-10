import { describe, expect, it } from "vitest";
import { buildPostFixVerificationEngines } from "../src/commands/fix.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";

describe("buildPostFixVerificationEngines", () => {
	it("disables lint during post-fix verification", () => {
		const engines = buildPostFixVerificationEngines(DEFAULT_CONFIG.engines);

		expect(engines.lint).toBe(false);
	});

	it("preserves the user's non-lint engine choices", () => {
		const engines = buildPostFixVerificationEngines({
			...DEFAULT_CONFIG.engines,
			format: false,
			"ai-slop": false,
			architecture: true,
		});

		expect(engines).toEqual({
			...DEFAULT_CONFIG.engines,
			format: false,
			lint: false,
			"ai-slop": false,
			architecture: true,
		});
	});
});
