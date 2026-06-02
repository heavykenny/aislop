import { describe, expect, it } from "vitest";
import { computeScanExitCode } from "../src/commands/scan-exit-code.js";

describe("computeScanExitCode", () => {
	it("fails on error diagnostics even when the score is withheld", () => {
		expect(computeScanExitCode({ hasErrors: true, scoreable: false, score: 0, failBelow: 70 })).toBe(1);
	});

	it("fails on error diagnostics when scoreable", () => {
		expect(computeScanExitCode({ hasErrors: true, scoreable: true, score: 100, failBelow: 70 })).toBe(1);
	});

	it("does not gate on a withheld score below the threshold", () => {
		expect(computeScanExitCode({ hasErrors: false, scoreable: false, score: 0, failBelow: 70 })).toBe(0);
	});

	it("fails a scoreable run below the threshold", () => {
		expect(computeScanExitCode({ hasErrors: false, scoreable: true, score: 50, failBelow: 70 })).toBe(1);
	});

	it("passes a scoreable run at or above the threshold", () => {
		expect(computeScanExitCode({ hasErrors: false, scoreable: true, score: 80, failBelow: 70 })).toBe(0);
	});
});
