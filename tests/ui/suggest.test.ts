import { describe, expect, it } from "vitest";
import { suggestClosest } from "../../src/ui/suggest.js";

const COMMANDS = ["scan", "fix", "agent", "init", "doctor", "ci", "rules", "badge", "trend"];

describe("suggestClosest", () => {
	it("suggests the closest command for a near miss", () => {
		expect(suggestClosest("gent", COMMANDS)).toBe("agent");
		expect(suggestClosest("scn", COMMANDS)).toBe("scan");
		expect(suggestClosest("docter", COMMANDS)).toBe("doctor");
	});

	it("returns null when nothing is close enough", () => {
		expect(suggestClosest("xyzzy", COMMANDS)).toBeNull();
		expect(suggestClosest("deploy", COMMANDS)).toBeNull();
	});

	it("is case-insensitive", () => {
		expect(suggestClosest("AGNT", COMMANDS)).toBe("agent");
	});
});
