import { describe, expect, it } from "vitest";
import { detectInvocation } from "../../src/ui/invocation.js";

describe("invocation", () => {
	it("returns the installed binary name for concise local hints", () => {
		expect(detectInvocation()).toBe("aislop");
	});
});
