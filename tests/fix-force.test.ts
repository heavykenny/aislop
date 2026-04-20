import { describe, expect, it } from "vitest";
import {
	collectPnpmOverrides,
	overrideKey,
	patchedRangeToVersion,
	type PnpmAdvisory,
} from "../src/commands/fix-force.js";

describe("patchedRangeToVersion", () => {
	it("handles a simple >=", () => {
		expect(patchedRangeToVersion(">=8.18.0")).toBe("^8.18.0");
	});

	it("handles a range with upper bound", () => {
		expect(patchedRangeToVersion(">=8.18.0 <9")).toBe("^8.18.0");
	});

	it("tolerates the > form", () => {
		expect(patchedRangeToVersion(">1.2.3")).toBe("^1.2.3");
	});

	it("returns null for shapes it can't interpret", () => {
		expect(patchedRangeToVersion("*")).toBeNull();
		expect(patchedRangeToVersion("")).toBeNull();
		expect(patchedRangeToVersion("unknown")).toBeNull();
	});
});

describe("overrideKey", () => {
	it("uses vulnerable_versions when present and specific", () => {
		expect(overrideKey("ajv", "<8.18.0", ">=8.18.0")).toBe("ajv@<8.18.0");
	});

	it("falls back to patched-based upper bound when vulnerable is *", () => {
		expect(overrideKey("pkg", "*", ">=2.0.0")).toBe("pkg@<2.0.0");
	});

	it("falls back when vulnerable is empty", () => {
		expect(overrideKey("pkg", "", ">=2.0.0")).toBe("pkg@<2.0.0");
		expect(overrideKey("pkg", undefined, ">=2.0.0")).toBe("pkg@<2.0.0");
	});

	it("drops to bare name if no version parseable in patched", () => {
		expect(overrideKey("pkg", undefined, "unknown")).toBe("pkg");
	});
});

describe("collectPnpmOverrides", () => {
	it("maps an advisories block to a surgical overrides map", () => {
		const advisories: Record<string, PnpmAdvisory> = {
			"1234": {
				module_name: "ajv",
				vulnerable_versions: ">=7.0.0-alpha.0 <8.18.0",
				patched_versions: ">=8.18.0",
			},
			"5678": {
				module_name: "lodash",
				vulnerable_versions: "<4.17.21",
				patched_versions: ">=4.17.21",
			},
		};
		expect(collectPnpmOverrides(advisories)).toEqual({
			"ajv@>=7.0.0-alpha.0 <8.18.0": "^8.18.0",
			"lodash@<4.17.21": "^4.17.21",
		});
	});

	it("skips advisories with unparseable patched_versions", () => {
		const advisories: Record<string, PnpmAdvisory> = {
			"1": { module_name: "pkg", patched_versions: "*" },
		};
		expect(collectPnpmOverrides(advisories)).toEqual({});
	});

	it("skips advisories missing module_name or patched_versions", () => {
		const advisories: Record<string, PnpmAdvisory> = {
			"1": { module_name: "pkg" },
			"2": { patched_versions: ">=1.0.0" },
		};
		expect(collectPnpmOverrides(advisories)).toEqual({});
	});
});
