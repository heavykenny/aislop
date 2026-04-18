import { describe, expect, it } from "vitest";
import { buildFixRender } from "../../src/commands/fix.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI_RE, "");

describe("fix render", () => {
	it("renders rail steps and a footer with remaining count", () => {
		const out = strip(
			buildFixRender({
				projectName: "my-app",
				steps: [
					{ status: "done", label: "Removed 12 unused imports" },
					{ status: "done", label: "Applied 4 lint autofixes" },
					{ status: "active", label: "Formatting…" },
				],
				fixed: 18,
				remaining: 3,
				nextAgentHint: "Run aislop fix --claude to hand off the 3 remaining issues",
			}),
		);
		expect(out).toContain("fix");
		expect(out).toContain("my-app");
		expect(out).toContain("◆ Removed 12 unused imports");
		expect(out).toContain("◇ Formatting…");
		expect(out).toContain("└  Done · 18 fixed · 3 remain");
		expect(out).toContain("→ Run aislop fix --claude");
	});

	it("omits the agent hint when remaining is zero", () => {
		const out = strip(
			buildFixRender({
				projectName: "my-app",
				steps: [{ status: "done", label: "All good" }],
				fixed: 5,
				remaining: 0,
			}),
		);
		expect(out).not.toContain("--claude");
		expect(out).toContain("└  Done · 5 fixed · 0 remain");
	});
});
