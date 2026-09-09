import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBundledJbSettings } from "../../src/utils/tooling.js";

describe("bundled jb settings", () => {
	it("ships aislop.DotSettings and resolves its path", () => {
		const settingsPath = resolveBundledJbSettings();
		expect(settingsPath).not.toBeNull();
		const contents = fs.readFileSync(settingsPath as string, "utf-8");
		expect(contents).toContain("=InconsistentNaming/@EntryIndexedValue");
		expect(contents).toContain("DO_NOT_SHOW");
	});
});
