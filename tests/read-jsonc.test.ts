import { describe, expect, it } from "vitest";
import { parseJsonc, stripJsonComments } from "../src/utils/read-jsonc.js";

describe("read-jsonc", () => {
	it("strips block comments before parsing", () => {
		const raw = `{
  "compilerOptions": {
    /* Bundler mode */
    "paths": { "@/*": ["./src/*"] }
  }
}`;
		const parsed = parseJsonc(raw) as { compilerOptions: { paths: Record<string, string[]> } };
		expect(parsed.compilerOptions.paths["@/*"]).toEqual(["./src/*"]);
	});

	it("returns null for invalid JSON after comment strip", () => {
		expect(parseJsonc('{ "a": 1, }')).toBeNull();
	});
});