import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTelemetryForTests } from "../../src/telemetry/client.js";
import { buildCommandFailedProps, errorIdentity } from "../../src/telemetry/events.js";
import { markErrorReported, reportFatalError } from "../../src/telemetry/fatal.js";

const captureStderr = (): { lines: string[]; restore: () => void } => {
	const lines: string[] = [];
	const original = process.stderr.write;
	process.stderr.write = ((chunk: unknown) => {
		lines.push(String(chunk));
		return true;
	}) as typeof process.stderr.write;
	return {
		lines,
		restore: () => {
			process.stderr.write = original;
		},
	};
};

const parseEvents = (lines: string[]): Array<{ event: string; properties: Record<string, unknown> }> =>
	lines
		.map((l) => l.match(/^\[telemetry\] (\{.*\})\n?$/))
		.filter((m): m is RegExpMatchArray => !!m)
		.map((m) => JSON.parse(m[1]));

describe("errorIdentity", () => {
	it("captures the error name and a safe code, never the message or paths", () => {
		const err = new Error("/Users/me/project/.env contained OPENAI_API_KEY=sk-secret") as NodeJS.ErrnoException;
		err.code = "ENOENT";
		const id = errorIdentity(err);
		expect(id.error_name).toBe("Error");
		expect(id.error_code).toBe("ENOENT");
		const serialized = JSON.stringify(id);
		expect(serialized).not.toContain("sk-secret");
		expect(serialized).not.toContain("/Users/me");
	});

	it("rejects message-shaped codes", () => {
		const err = new Error("boom") as { code?: unknown };
		err.code = "Cannot read /Users/me/x";
		expect(errorIdentity(err).error_code).toBeUndefined();
	});

	it("keeps numeric codes", () => {
		const err = new Error("boom") as { code?: unknown };
		err.code = 137;
		expect(errorIdentity(err).error_code).toBe("137");
	});

	it("describes non-Error throws without leaking their value", () => {
		expect(errorIdentity("a secret string reason").error_name).toBe("string");
		expect(errorIdentity(null).error_name).toBe("null");
		expect(errorIdentity(42).error_name).toBe("number");
		expect(errorIdentity({ secret: "x" }).error_name).toBe("object");
	});

	it("uses a custom error subclass name", () => {
		class ConfigError extends Error {}
		const err = new ConfigError("bad");
		err.name = "ConfigError";
		expect(errorIdentity(err).error_name).toBe("ConfigError");
	});
});

describe("buildCommandFailedProps", () => {
	it("emits only the safe failure shape", () => {
		const err = new TypeError("undefined is not a function at /Users/me/app.ts:3");
		const props = buildCommandFailedProps({ error: err, stage: "uncaught_exception" });
		expect(props).toEqual({ failed_stage: "uncaught_exception", error_name: "TypeError" });
		expect(JSON.stringify(props)).not.toContain("/Users/me");
	});
});

describe("reportFatalError", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		delete process.env.AISLOP_NO_TELEMETRY;
		delete process.env.DO_NOT_TRACK;
		delete process.env.CI;
		process.env.AISLOP_TELEMETRY_DEBUG = "1";
		process.env.AISLOP_TELEMETRY_DRY_RUN = "1";
		resetTelemetryForTests();
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		resetTelemetryForTests();
	});

	it("emits cli_command_failed with the safe failure shape", async () => {
		const cap = captureStderr();
		try {
			await reportFatalError(new RangeError("out of range"), "unhandled_rejection");
			const failed = parseEvents(cap.lines).find((e) => e.event === "cli_command_failed");
			expect(failed).toBeDefined();
			expect(failed?.properties.failed_stage).toBe("unhandled_rejection");
			expect(failed?.properties.error_name).toBe("RangeError");
		} finally {
			cap.restore();
		}
	});

	it("sends nothing when telemetry is opted out", async () => {
		process.env.AISLOP_NO_TELEMETRY = "1";
		const cap = captureStderr();
		try {
			await reportFatalError(new Error("boom"), "main");
			expect(cap.lines.filter((l) => l.startsWith("[telemetry]"))).toHaveLength(0);
		} finally {
			cap.restore();
		}
	});

	it("does not double-report an error the lifecycle already handled", async () => {
		const cap = captureStderr();
		try {
			const err = new Error("already counted");
			markErrorReported(err);
			await reportFatalError(err, "main");
			expect(parseEvents(cap.lines).find((e) => e.event === "cli_command_failed")).toBeUndefined();
		} finally {
			cap.restore();
		}
	});
});
