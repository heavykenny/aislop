import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTelemetryDisabled } from "../../src/telemetry/client.js";

describe("isTelemetryDisabled — opt-out precedence", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		delete process.env.AISLOP_NO_TELEMETRY;
		delete process.env.DO_NOT_TRACK;
		delete process.env.CI;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("returns false when nothing is set", () => {
		expect(isTelemetryDisabled()).toBe(false);
	});

	it("AISLOP_NO_TELEMETRY=1 wins over everything", () => {
		process.env.AISLOP_NO_TELEMETRY = "1";
		expect(isTelemetryDisabled({ enabled: true })).toBe(true);
	});

	it("DO_NOT_TRACK=1 wins over everything", () => {
		process.env.DO_NOT_TRACK = "1";
		expect(isTelemetryDisabled({ enabled: true })).toBe(true);
	});

	it("explicit config.enabled=true overrides CI=true default", () => {
		process.env.CI = "true";
		expect(isTelemetryDisabled({ enabled: true })).toBe(false);
	});

	it("CI=true with no explicit config disables", () => {
		process.env.CI = "true";
		expect(isTelemetryDisabled()).toBe(true);
	});

	it("config.enabled=false disables", () => {
		expect(isTelemetryDisabled({ enabled: false })).toBe(true);
	});
});
