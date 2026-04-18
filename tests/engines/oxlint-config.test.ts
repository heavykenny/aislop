import { describe, expect, it } from "vitest";
import { createOxlintConfig } from "../../src/engines/lint/oxlint-config.js";

describe("createOxlintConfig", () => {
	it("keeps no-undef as error for standard JS/TS projects", () => {
		const config = createOxlintConfig({ framework: "none" }) as {
			rules: Record<string, string>;
		};
		expect(config.rules["no-undef"]).toBe("error");
	});

	it("disables no-undef for Astro projects (Astro globals + define:vars inject runtime names oxlint can't resolve)", () => {
		const config = createOxlintConfig({ framework: "astro" }) as {
			rules: Record<string, string>;
			globals: Record<string, string>;
		};
		expect(config.rules["no-undef"]).toBe("off");
		expect(config.globals.Astro).toBe("readonly");
	});

	it("disables no-unused-expressions for Astro projects (third-party inline-script IIFEs)", () => {
		const config = createOxlintConfig({ framework: "astro" }) as {
			rules: Record<string, string>;
		};
		expect(config.rules["no-unused-expressions"]).toBe("off");
	});
});
