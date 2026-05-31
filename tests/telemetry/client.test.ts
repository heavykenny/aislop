import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	flushTelemetry,
	isTelemetryDisabled,
	resetTelemetryForTests,
	track,
} from "../../src/telemetry/client.js";
import { ensureInstallId, resolveInstallIdPath } from "../../src/telemetry/identity.js";

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

describe("track — distinct_id stitching", () => {
	const originalEnv = { ...process.env };
	let tmpHome: string;
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		delete process.env.AISLOP_NO_TELEMETRY;
		delete process.env.DO_NOT_TRACK;
		delete process.env.CI;
		delete process.env.AISLOP_TELEMETRY_DRY_RUN;
		delete process.env.XDG_STATE_HOME;
		// resolveInstallIdPath() reads os.homedir(), which honors $HOME on POSIX.
		tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-distinct-"));
		process.env.HOME = tmpHome;
		resetTelemetryForTests();
		fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		resetTelemetryForTests();
		process.env = { ...originalEnv };
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	const bodyOf = (call: number): Record<string, unknown> =>
		JSON.parse(String(fetchMock.mock.calls[call][1].body));

	it("sets distinct_id to the persistent install id, matching anonymous_install_id", async () => {
		track({ event: "cli_installed", config: { enabled: true } });
		await flushTelemetry();

		// Resolve the persisted id through the same code path the client uses.
		const installId = ensureInstallId(resolveInstallIdPath()).installId;
		const body = bodyOf(0);
		expect(body.distinct_id).toBe(installId);
		expect((body.properties as Record<string, unknown>).anonymous_install_id).toBe(installId);
	});

	it("keeps distinct_id stable across multiple events", async () => {
		track({ event: "cli_command_started", config: { enabled: true } });
		track({ event: "cli_command_completed", config: { enabled: true } });
		track({ event: "mcp_server_started", config: { enabled: true } });
		await flushTelemetry();

		const ids = fetchMock.mock.calls.map((_, i) => bodyOf(i).distinct_id);
		expect(ids).toHaveLength(3);
		expect(new Set(ids).size).toBe(1);
		expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
	});
});

describe("flushTelemetry — bounded flush (per-edit hook path)", () => {
	const originalEnv = { ...process.env };
	let tmpHome: string;

	beforeEach(() => {
		delete process.env.AISLOP_NO_TELEMETRY;
		delete process.env.DO_NOT_TRACK;
		delete process.env.CI;
		delete process.env.AISLOP_TELEMETRY_DRY_RUN;
		delete process.env.XDG_STATE_HOME;
		tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-flush-"));
		process.env.HOME = tmpHome;
		resetTelemetryForTests();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		resetTelemetryForTests();
		process.env = { ...originalEnv };
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	it("returns within the cap when the request hangs, so the hook never stalls", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => new Promise(() => {})),
		);
		track({ event: "hook_scan_completed", config: { enabled: true } });

		const start = Date.now();
		await flushTelemetry(50);
		expect(Date.now() - start).toBeLessThan(500);
	});

	it("delivers the queued event when the request resolves in time", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		track({ event: "hook_scan_completed", config: { enabled: true } });

		await flushTelemetry(1500);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
