import { describe, expect, it } from "vitest";
import { createOxlintConfig } from "../src/engines/lint/oxlint-config.js";

const rulesOf = (config: Record<string, unknown>): Record<string, string> =>
	config.rules as Record<string, string>;

describe("createOxlintConfig — fixer safety", () => {
	it("does not let the fixer strip aria-hidden from focusable elements", () => {
		const rules = rulesOf(createOxlintConfig({ framework: "react", mode: "fix" }));
		expect(rules["jsx-a11y/no-aria-hidden-on-focusable"]).toBe("off");
	});

	it("leaves the rule untouched outside fix mode so the scan can still surface it", () => {
		const rules = rulesOf(createOxlintConfig({ framework: "react", mode: "detect" }));
		expect(rules["jsx-a11y/no-aria-hidden-on-focusable"]).toBeUndefined();
	});
});
