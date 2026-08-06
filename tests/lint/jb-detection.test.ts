import { describe, expect, it } from "vitest";
import { TOOLS_TO_CHECK } from "../../src/utils/discover.js";

describe("jb tool detection", () => {
	it("includes jb in the set of tools probed on PATH", () => {
		expect(TOOLS_TO_CHECK).toContain("jb");
	});
});
