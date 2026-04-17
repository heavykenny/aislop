import { describe, expect, it } from "vitest";
import { buildInitSuccessRender } from "../../src/commands/init.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI_RE, "");

describe("init render", () => {
	it("renders a rail with the config path and next-step hint", () => {
		const out = strip(
			buildInitSuccessRender({ configPath: ".aislop/config.yml", nextCommand: "aislop scan" }),
		);
		expect(out).toContain("init");
		expect(out).toContain("└  Wrote .aislop/config.yml");
		expect(out).toContain("→ Try aislop scan");
	});
});
