import { describe, expect, it } from "vitest";
import {
	formatUpdateNotice,
	isOutdated,
	isUpdateNotifierDisabled,
	parseVersion,
	resolveUpdateCachePath,
} from "../src/update-notifier.js";

describe("parseVersion", () => {
	it("parses a plain semver", () => {
		expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
	});

	it("tolerates a v prefix and prerelease/build metadata", () => {
		expect(parseVersion("v0.10.1")).toEqual({ major: 0, minor: 10, patch: 1 });
		expect(parseVersion("0.10.1-beta.2")).toEqual({ major: 0, minor: 10, patch: 1 });
	});

	it("returns null for non-semver input", () => {
		expect(parseVersion("latest")).toBeNull();
		expect(parseVersion("1.2")).toBeNull();
	});
});

describe("isOutdated", () => {
	it("is true when latest is a higher patch, minor, or major", () => {
		expect(isOutdated("0.10.0", "0.10.1")).toBe(true);
		expect(isOutdated("0.9.4", "0.10.0")).toBe(true);
		expect(isOutdated("0.10.4", "1.0.0")).toBe(true);
	});

	it("is false when current is equal or ahead", () => {
		expect(isOutdated("0.10.1", "0.10.1")).toBe(false);
		expect(isOutdated("0.10.2", "0.10.1")).toBe(false);
		expect(isOutdated("1.0.0", "0.10.9")).toBe(false);
	});

	it("is false when either version is unparseable", () => {
		expect(isOutdated("0.10.0", "latest")).toBe(false);
		expect(isOutdated("", "0.10.1")).toBe(false);
	});
});

describe("isUpdateNotifierDisabled", () => {
	it("respects opt-out env vars", () => {
		expect(isUpdateNotifierDisabled({ AISLOP_NO_UPDATE_NOTIFIER: "1" })).toBe(true);
		expect(isUpdateNotifierDisabled({ NO_UPDATE_NOTIFIER: "1" })).toBe(true);
		expect(isUpdateNotifierDisabled({ DO_NOT_TRACK: "1" })).toBe(true);
	});

	it("is disabled in CI", () => {
		expect(isUpdateNotifierDisabled({ CI: "true" })).toBe(true);
		expect(isUpdateNotifierDisabled({ GITHUB_ACTIONS: "true" })).toBe(true);
	});

	it("is enabled by default for an interactive shell", () => {
		expect(isUpdateNotifierDisabled({})).toBe(false);
	});
});

describe("formatUpdateNotice", () => {
	it("names both versions and the global upgrade command", () => {
		const notice = formatUpdateNotice("0.9.4", "0.10.1");
		expect(notice).toContain("0.9.4");
		expect(notice).toContain("0.10.1");
		expect(notice).toContain("npm i -g aislop@latest");
		expect(notice).toContain("npx aislop@latest");
	});
});

describe("resolveUpdateCachePath", () => {
	it("defaults under the home .aislop dir", () => {
		const cachePath = resolveUpdateCachePath("/home/alice", {});
		expect(cachePath).toContain(".aislop");
		expect(cachePath).toContain("update_check.json");
	});
});
