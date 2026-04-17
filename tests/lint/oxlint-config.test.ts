import { describe, expect, it } from "vitest";
import { createOxlintConfig } from "../../src/engines/lint/oxlint-config.js";

describe("createOxlintConfig", () => {
	it("sets no-unused-vars to 'off' when mode is 'fix' (prevents destructive auto-fix)", () => {
		const config = createOxlintConfig({ mode: "fix" });
		const rules = config.rules as Record<string, string>;
		expect(rules["no-unused-vars"]).toBe("off");
	});

	it("sets no-unused-vars to 'warn' when mode is 'detect'", () => {
		const config = createOxlintConfig({ mode: "detect" });
		const rules = config.rules as Record<string, string>;
		expect(rules["no-unused-vars"]).toBe("warn");
	});

	it("defaults to detect behavior when mode is omitted", () => {
		const config = createOxlintConfig({});
		const rules = config.rules as Record<string, string>;
		expect(rules["no-unused-vars"]).toBe("warn");
	});
});
