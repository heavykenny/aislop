import { describe, expect, it } from "vitest";
import {
	collectPnpmOverrides,
	isDowngrade,
	overrideKey,
	parseSemverMin,
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

describe("parseSemverMin", () => {
	it("strips leading ^/~ and parses major.minor.patch", () => {
		expect(parseSemverMin("^13.6.0")).toEqual([13, 6, 0]);
		expect(parseSemverMin("~7.2.0")).toEqual([7, 2, 0]);
		expect(parseSemverMin("13.6.0")).toEqual([13, 6, 0]);
	});

	it("tolerates trailing pre-release tags", () => {
		expect(parseSemverMin("^7.2.0-rc.1")).toEqual([7, 2, 0]);
	});

	it("treats x / X / * wildcards as 0 so `^11.x.x` is comparable", () => {
		expect(parseSemverMin("^11.x.x")).toEqual([11, 0, 0]);
		expect(parseSemverMin("^11.X")).toEqual([11, 0, 0]);
		expect(parseSemverMin("^11.*")).toEqual([11, 0, 0]);
		expect(parseSemverMin("11")).toEqual([11, 0, 0]);
	});

	it("returns null for non-semver shapes", () => {
		expect(parseSemverMin("*")).toBeNull();
		expect(parseSemverMin("workspace:*")).toBeNull();
		expect(parseSemverMin("github:owner/repo")).toBeNull();
	});
});

describe("isDowngrade", () => {
	it("flags a major version drop (the real-world npm audit fix case)", () => {
		expect(isDowngrade("^13.6.0", "^12.1.0")).toBe(true); // firebase-admin
		expect(isDowngrade("^11.0.0", "^7.2.0")).toBe(true); // mocha
	});

	it("flags downgrades from x-wildcard specs (`^11.x.x` → `^7.2.0`)", () => {
		expect(isDowngrade("^11.x.x", "^7.2.0")).toBe(true);
		expect(isDowngrade("^4.x", "^3.0.0")).toBe(true);
	});

	it("flags minor + patch downgrades", () => {
		expect(isDowngrade("^13.6.0", "^13.4.0")).toBe(true);
		expect(isDowngrade("^13.6.5", "^13.6.0")).toBe(true);
	});

	it("does not flag legitimate upgrades", () => {
		expect(isDowngrade("^12.1.0", "^13.6.0")).toBe(false);
		expect(isDowngrade("^19.0.2", "^22.0.0")).toBe(false); // sinon
		expect(isDowngrade("^1.0.0", "^1.0.1")).toBe(false);
	});

	it("does not flag identical versions", () => {
		expect(isDowngrade("^1.2.3", "^1.2.3")).toBe(false);
	});

	it("returns false when either side is unparseable (no info, do nothing)", () => {
		expect(isDowngrade("workspace:*", "^1.0.0")).toBe(false);
		expect(isDowngrade("^1.0.0", "workspace:*")).toBe(false);
	});
});
