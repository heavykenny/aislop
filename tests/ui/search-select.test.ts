import { describe, expect, it } from "vitest";
import { filterSearchItems, renderSearchLines } from "../../src/ui/search-select.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

const items = [
	{
		value: "console-leftover",
		label: "ai-slop/console-leftover",
		hint: "console/debug output was left in application code.",
		keywords: ["AI Slop", "debug"],
	},
	{
		value: "hardcoded-secret",
		label: "security/hardcoded-secret",
		hint: "Secret-looking token is embedded in source.",
		keywords: ["Security"],
	},
];

describe("search select", () => {
	it("filters by label, hint, and keywords", () => {
		expect(filterSearchItems(items, "console")).toHaveLength(1);
		expect(filterSearchItems(items, "debug")).toHaveLength(1);
		expect(filterSearchItems(items, "security secret")).toHaveLength(1);
		expect(filterSearchItems(items, "missing")).toHaveLength(0);
	});

	it("ranks label prefix matches before hint-only matches", () => {
		const results = filterSearchItems(
			[
				{ value: "doctor", label: "Doctor", hint: "Check required tools" },
				{ value: "quit", label: "Quit", hint: "Exit" },
			],
			"q",
		);

		expect(results.map((item) => item.value)).toEqual(["quit", "doctor"]);
	});

	it("renders a searchable prompt with hints", () => {
		const out = strip(
			renderSearchLines({
				message: "Search rules",
				items,
				query: "console",
				cursor: 0,
				selected: new Set(),
				mode: "single",
				state: "active",
			}).join("\n"),
		);

		expect(out).toContain("Search rules");
		expect(out).toContain("Search: console");
		expect(out).toContain("ai-slop/console-leftover");
		expect(out).toContain("type to filter");
		expect(out).not.toContain("security/hardcoded-secret");
	});

	it("aligns hints after labels with different widths", () => {
		const out = strip(
			renderSearchLines({
				message: "What would you like to do?",
				items: [
					{ value: "fix", label: "Fix", hint: "Auto-fix or hand off remaining findings" },
					{ value: "agent", label: "Agent", hint: "Run local worktree repair" },
					{
						value: "hook-install",
						label: "Install hooks",
						hint: "Run aislop after agent edits",
					},
				],
				query: "",
				cursor: 0,
				selected: new Set(),
				mode: "single",
				state: "active",
			}).join("\n"),
		);

		const lines = out.split("\n");
		const fixLine = lines.find((line) => line.includes("Fix"));
		const agentLine = lines.find((line) => line.includes("Agent"));
		const hookLine = lines.find((line) => line.includes("Install hooks"));
		const hintColumn = fixLine?.indexOf("Auto-fix");

		expect(hintColumn).toBeGreaterThan(-1);
		expect(agentLine?.indexOf("Run local worktree repair")).toBe(hintColumn);
		expect(hookLine?.indexOf("Run aislop after agent edits")).toBe(hintColumn);
	});
});
