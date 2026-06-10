import { describe, expect, it } from "vitest";
import { renderDisplayStatusItems } from "../../src/ui/display.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

describe("renderDisplayStatusItems", () => {
	it("keeps detail values aligned across grouped status items", () => {
		const out = strip(
			renderDisplayStatusItems([
				{
					marker: "✓",
					label: "codex",
					rows: [
						{ label: "Status", value: "installed" },
						{ label: "Scope", value: "global" },
					],
				},
				{
					marker: "·",
					label: "opencode",
					rows: [
						{ label: "Status", value: "not installed" },
						{ label: "Connect", value: "aislop agent connect opencode" },
					],
				},
			]).join("\n"),
		);

		expect(out).toContain("✓ codex");
		expect(out).toContain("· opencode");
		expect(out).not.toMatch(/codex\s+installed/);

		const lines = out.split("\n");
		const statusLine = lines.find((line) => line.includes("Status") && line.includes("installed"));
		const scopeLine = lines.find((line) => line.includes("Scope"));
		const connectLine = lines.find((line) => line.includes("Connect"));
		expect(statusLine?.indexOf("installed")).toBe(scopeLine?.indexOf("global"));
		expect(statusLine?.indexOf("installed")).toBe(
			connectLine?.indexOf("aislop agent connect opencode"),
		);
	});
});
