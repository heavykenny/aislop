import { describe, expect, it } from "vitest";
import { buildInitSuccessRender } from "../../src/commands/init.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

describe("init render", () => {
	it("renders a rail with each written file and a count footer", () => {
		const out = strip(
			buildInitSuccessRender({
				steps: [
					{ status: "done", label: "Wrote .aislop/config.yml" },
					{ status: "done", label: "Wrote .github/workflows/aislop.yml" },
				],
				nextCommand: "aislop scan",
			}),
		);
		expect(out).toContain("Setup");
		expect(out).toContain("Wrote .aislop/config.yml");
		expect(out).toContain("Wrote .github/workflows/aislop.yml");
		expect(out).toContain("Done · wrote 2 files");
		expect(out).toContain("→ Try aislop scan");
	});

	it("renders a single-file footer when only one file was written", () => {
		const out = strip(
			buildInitSuccessRender({
				steps: [{ status: "done", label: "Wrote .aislop/config.yml" }],
				nextCommand: "aislop scan",
			}),
		);
		expect(out).toContain("Done · wrote 1 file");
		expect(out).not.toContain("1 files");
	});
});
