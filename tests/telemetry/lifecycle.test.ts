import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTelemetryForTests } from "../../src/telemetry/client.js";
import { withCommandLifecycle } from "../../src/telemetry/lifecycle.js";

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

describe("withCommandLifecycle", () => {
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

	it("fires _started then _completed on success", async () => {
		const cap = captureStderr();
		try {
			const result = await withCommandLifecycle({ command: "scan" }, async () => ({
				exitCode: 0,
				score: 88,
			}));
			expect(result.exitCode).toBe(0);
			const events = cap.lines
				.map((l) => l.match(/^\[telemetry\] (\{.*\})\n?$/))
				.filter((m): m is RegExpMatchArray => !!m)
				.map((m) => JSON.parse(m[1]));
			const eventNames = events.map((e) => e.event);
			expect(eventNames[0]).toBe("cli_command_started");
			expect(eventNames[eventNames.length - 1]).toBe("cli_command_completed");
		} finally {
			cap.restore();
		}
	});

	it("carries allowlisted agent properties and drops unsafe ones", async () => {
		const cap = captureStderr();
		try {
			const result = await withCommandLifecycle(
				{
					command: "agent",
					properties: {
						provider: "codex",
						provider_source: "cli",
						target_score: 90,
						dry_run: true,
						file_path: "/Users/me/project/secret.ts",
					},
				},
				async () => ({
					exitCode: 0,
					properties: {
						agent_result: "dry_run",
						score_before: 82,
						score_after: 91,
						score_delta: 9,
						changed_files: 2,
					},
				}),
			);
			expect(result.exitCode).toBe(0);
			const events = cap.lines
				.map((l) => l.match(/^\[telemetry\] (\{.*\})\n?$/))
				.filter((m): m is RegExpMatchArray => !!m)
				.map((m) => JSON.parse(m[1]));
			const started = events.find((e) => e.event === "cli_command_started");
			const completed = events.find((e) => e.event === "cli_command_completed");
			expect(started?.properties).toMatchObject({
				command: "agent",
				provider: "codex",
				provider_source: "cli",
				target_score: 90,
				dry_run: true,
			});
			expect(started?.properties.file_path).toBeUndefined();
			expect(completed?.properties).toMatchObject({
				command: "agent",
				agent_result: "dry_run",
				score_before: 82,
				score_after: 91,
				score_delta: 9,
				changed_files: 2,
			});
			expect(cap.lines).toContain("[telemetry] dropped non-allowlisted property: file_path\n");
		} finally {
			cap.restore();
		}
	});

	it("fires _completed with exit_code=1 and error_kind on throw", async () => {
		const cap = captureStderr();
		try {
			await expect(
				withCommandLifecycle({ command: "scan" }, async () => {
					throw new Error("config_invalid: bad yaml");
				}),
			).rejects.toThrow("config_invalid: bad yaml");
			const events = cap.lines
				.map((l) => l.match(/^\[telemetry\] (\{.*\})\n?$/))
				.filter((m): m is RegExpMatchArray => !!m)
				.map((m) => JSON.parse(m[1]));
			const completed = events.find((e) => e.event === "cli_command_completed");
			expect(completed).toBeDefined();
			expect(completed.properties.exit_code).toBe(1);
			expect(completed.properties.error_kind).toBe("config_invalid");
		} finally {
			cap.restore();
		}
	});

	it("skips telemetry entirely when disabled", async () => {
		process.env.AISLOP_NO_TELEMETRY = "1";
		const cap = captureStderr();
		try {
			const result = await withCommandLifecycle({ command: "scan" }, async () => ({ exitCode: 0 }));
			expect(result.exitCode).toBe(0);
			const events = cap.lines.filter((l) => l.startsWith("[telemetry]"));
			expect(events).toHaveLength(0);
		} finally {
			cap.restore();
		}
	});
});
