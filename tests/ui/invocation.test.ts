import { describe, expect, it } from "vitest";
import { detectInvocation } from "../../src/ui/invocation.js";

describe("invocation", () => {
	it("returns 'npx aislop' so hints work regardless of install method", () => {
		expect(detectInvocation()).toBe("npx aislop");
	});
});
