import { describe, expect, it } from "vitest";
import { buildUpdateStatusRender } from "../../src/commands/update.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

describe("update render", () => {
	it("shows current and latest when already up to date", () => {
		const out = strip(buildUpdateStatusRender({ current: "0.10.2", latest: "0.10.2" }));

		expect(out).toContain("Current: 0.10.2");
		expect(out).toContain("Latest:  0.10.2");
		expect(out).toContain("Status: aislop is up to date.");
		expect(out).toContain("Latest commands:");
		expect(out).toContain("npm i -g aislop@latest");
		expect(out).toContain("npx aislop@latest");
	});

	it("shows both versions when an update is available", () => {
		const out = strip(buildUpdateStatusRender({ current: "0.10.1", latest: "0.10.2" }));

		expect(out).toContain("Current: 0.10.1");
		expect(out).toContain("Latest:  0.10.2");
		expect(out).toContain("Status: update available (0.10.1 -> 0.10.2).");
		expect(out).toContain("Upgrade:");
	});

	it("still shows current when npm cannot be reached", () => {
		const out = strip(buildUpdateStatusRender({ current: "0.10.2", latest: null }));

		expect(out).toContain("Current: 0.10.2");
		expect(out).toContain("Latest:  unavailable");
		expect(out).toContain("could not reach the npm registry");
	});
});
