import { describe, expect, it } from "vitest";
import { isToolInstalled } from "../src/utils/subprocess.js";

describe("isToolInstalled", () => {
	it("detects system tools that are definitely on the PATH", async () => {
		// node and git are guaranteed to be installed for vitest / git checkout to even run.
		expect(await isToolInstalled("node")).toBe(true);
		expect(await isToolInstalled("git")).toBe(true);
	});

	it("returns false for completely non-existent tools", async () => {
		expect(await isToolInstalled("non-existent-tool-xyz-123")).toBe(false);
	});
});
