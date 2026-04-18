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

	it("disables react-hooks/exhaustive-deps autofix in fix mode (oxlint's autofix can produce TDZ errors when the missing dep is a hoisted const)", () => {
		const config = createOxlintConfig({ framework: "react", mode: "fix" });
		const rules = config.rules as Record<string, string>;
		expect(rules["react-hooks/exhaustive-deps"]).toBe("off");
	});

	it("keeps react-hooks/exhaustive-deps at 'warn' in detect mode so the detector still reports missing deps", () => {
		const config = createOxlintConfig({ framework: "react", mode: "detect" });
		const rules = config.rules as Record<string, string>;
		expect(rules["react-hooks/exhaustive-deps"]).toBe("warn");
	});
});
