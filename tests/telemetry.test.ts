import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getScoreBucket, isTelemetryDisabled } from "../src/utils/telemetry.js";

describe("isTelemetryDisabled", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Reset relevant env vars before each test
		delete process.env.AISLOP_NO_TELEMETRY;
		delete process.env.DO_NOT_TRACK;
		delete process.env.CI;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("returns false when no opt-out signals are present", () => {
		expect(isTelemetryDisabled()).toBe(false);
	});

	it("returns true when AISLOP_NO_TELEMETRY=1", () => {
		process.env.AISLOP_NO_TELEMETRY = "1";
		expect(isTelemetryDisabled()).toBe(true);
	});

	it("returns true when DO_NOT_TRACK=1", () => {
		process.env.DO_NOT_TRACK = "1";
		expect(isTelemetryDisabled()).toBe(true);
	});

	it("returns true when CI=true", () => {
		process.env.CI = "true";
		expect(isTelemetryDisabled()).toBe(true);
	});

	it("returns true when CI=1", () => {
		process.env.CI = "1";
		expect(isTelemetryDisabled()).toBe(true);
	});

	it("returns true when config enabled is false", () => {
		expect(isTelemetryDisabled(false)).toBe(true);
	});

	it("returns false when config enabled is true", () => {
		expect(isTelemetryDisabled(true)).toBe(false);
	});

	it("env var takes precedence over config enabled=true", () => {
		process.env.AISLOP_NO_TELEMETRY = "1";
		expect(isTelemetryDisabled(true)).toBe(true);
	});
});

describe("getScoreBucket", () => {
	it("returns '75-100' for scores >= 75", () => {
		expect(getScoreBucket(100)).toBe("75-100");
		expect(getScoreBucket(75)).toBe("75-100");
		expect(getScoreBucket(80)).toBe("75-100");
	});

	it("returns '50-75' for scores >= 50 and < 75", () => {
		expect(getScoreBucket(74)).toBe("50-75");
		expect(getScoreBucket(50)).toBe("50-75");
		expect(getScoreBucket(60)).toBe("50-75");
	});

	it("returns '25-50' for scores >= 25 and < 50", () => {
		expect(getScoreBucket(49)).toBe("25-50");
		expect(getScoreBucket(25)).toBe("25-50");
		expect(getScoreBucket(30)).toBe("25-50");
	});

	it("returns '0-25' for scores < 25", () => {
		expect(getScoreBucket(24)).toBe("0-25");
		expect(getScoreBucket(0)).toBe("0-25");
		expect(getScoreBucket(10)).toBe("0-25");
	});
});
