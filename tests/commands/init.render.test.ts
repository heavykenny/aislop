import { describe, expect, it } from "vitest";
import { buildInitSuccessRender } from "../../src/commands/init.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI_RE, "");

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
		expect(out).toContain("init");
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
