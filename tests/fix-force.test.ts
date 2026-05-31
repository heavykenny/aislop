import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	collectPnpmOverrides,
	guardOverrides,
	isDowngrade,
	overrideKey,
	type PnpmAdvisory,
	parseSemverMin,
	patchedRangeToVersion,
	readInstalledVersions,
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

describe("guardOverrides", () => {
	it("drops an override that pins a package below the installed version", () => {
		const installed = new Map([["firebase", "7.1.0"]]);
		const { safe, skipped } = guardOverrides({ "firebase@<4.9.0": "^4.9.0" }, installed);
		expect(safe).toEqual({});
		expect(skipped).toEqual(["firebase 7.1.0 → ^4.9.0"]);
	});

	it("keeps an override that is a genuine upgrade", () => {
		const installed = new Map([["ajv", "8.10.0"]]);
		const { safe, skipped } = guardOverrides({ "ajv@<8.18.0": "^8.18.0" }, installed);
		expect(safe).toEqual({ "ajv@<8.18.0": "^8.18.0" });
		expect(skipped).toEqual([]);
	});

	it("applies overrides for packages whose installed version is unknown", () => {
		const { safe, skipped } = guardOverrides({ "left-pad@<1.3.0": "^1.3.0" }, new Map());
		expect(safe).toEqual({ "left-pad@<1.3.0": "^1.3.0" });
		expect(skipped).toEqual([]);
	});

	it("resolves the package name from a scoped override key", () => {
		const installed = new Map([["@scope/pkg", "5.0.0"]]);
		const { safe, skipped } = guardOverrides({ "@scope/pkg@<2.0.0": "^2.0.0" }, installed);
		expect(safe).toEqual({});
		expect(skipped).toEqual(["@scope/pkg 5.0.0 → ^2.0.0"]);
	});
});

describe("readInstalledVersions", () => {
	let tmpDir: string;

	const writeManifest = (relDir: string, version: string) => {
		const dir = path.join(tmpDir, relDir);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version }), "utf-8");
	};

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-installed-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("reads a hoisted package from root node_modules", () => {
		writeManifest("node_modules/firebase", "7.1.0");
		expect(readInstalledVersions(tmpDir, ["firebase"]).get("firebase")).toBe("7.1.0");
	});

	it("falls back to the highest version in pnpm's virtual store", () => {
		fs.mkdirSync(path.join(tmpDir, "node_modules/.pnpm/uuid@3.4.0/node_modules/uuid"), {
			recursive: true,
		});
		fs.mkdirSync(path.join(tmpDir, "node_modules/.pnpm/uuid@7.0.0_react@18/node_modules/uuid"), {
			recursive: true,
		});
		expect(readInstalledVersions(tmpDir, ["uuid"]).get("uuid")).toBe("7.0.0");
	});

	it("resolves a scoped package from the pnpm store (slash becomes plus)", () => {
		fs.mkdirSync(path.join(tmpDir, "node_modules/.pnpm/@scope+pkg@5.0.0/node_modules/@scope/pkg"), {
			recursive: true,
		});
		expect(readInstalledVersions(tmpDir, ["@scope/pkg"]).get("@scope/pkg")).toBe("5.0.0");
	});

	it("omits packages that are not installed anywhere", () => {
		expect(readInstalledVersions(tmpDir, ["missing"]).has("missing")).toBe(false);
	});
});
