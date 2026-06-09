import { describe, expect, it } from "vitest";
import { buildUpdateStatusRender } from "../../src/commands/update.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

describe("update render", () => {
	it("shows current and latest when already up to date", () => {
		const out = strip(buildUpdateStatusRender({ current: "0.10.2", latest: "0.10.2" }));

		expect(out).toContain("Status");
		expect(out).toMatch(/Current\s+0\.10\.2/);
		expect(out).toMatch(/Latest\s+0\.10\.2/);
		expect(out).toMatch(/State\s+aislop is up to date\./);
		expect(out).toContain("Commands");
		expect(out).toMatch(/Upgrade\s+npm i -g aislop@latest/);
		expect(out).toMatch(/One-off\s+npx aislop@latest/);

		const lines = out.split("\n");
		const currentLine = lines.find((line) => line.includes("Current"));
		const stateLine = lines.find((line) => line.includes("State"));
		expect(currentLine?.indexOf("0.10.2")).toBe(stateLine?.indexOf("aislop is up to date."));
	});

	it("shows both versions when an update is available", () => {
		const out = strip(buildUpdateStatusRender({ current: "0.10.1", latest: "0.10.2" }));

		expect(out).toMatch(/Current\s+0\.10\.1/);
		expect(out).toMatch(/Latest\s+0\.10\.2/);
		expect(out).toMatch(/State\s+update available \(0\.10\.1 -> 0\.10\.2\)\./);
		expect(out).toMatch(/Upgrade\s+npm i -g aislop@latest/);
	});

	it("still shows current when npm cannot be reached", () => {
		const out = strip(buildUpdateStatusRender({ current: "0.10.2", latest: null }));

		expect(out).toMatch(/Current\s+0\.10\.2/);
		expect(out).toMatch(/Latest\s+unavailable/);
		expect(out).toMatch(/State\s+could not reach the npm registry/);
		expect(out).toMatch(/One-off\s+npx aislop@latest/);
	});
});
