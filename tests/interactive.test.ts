import { describe, expect, it } from "vitest";
import { INTERACTIVE_OPTIONS } from "../src/commands/interactive.js";

describe("interactive options", () => {
	it("exposes the six menu actions in a stable order", () => {
		expect(INTERACTIVE_OPTIONS.map((o) => o.value)).toEqual([
			"scan",
			"fix",
			"init",
			"doctor",
			"rules",
			"quit",
		]);
	});

	it("each option has a human-readable label and hint", () => {
		for (const opt of INTERACTIVE_OPTIONS) {
			expect(opt.label.length).toBeGreaterThan(0);
			expect(opt.hint.length).toBeGreaterThan(0);
		}
	});
});
