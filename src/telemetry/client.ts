import os from "node:os";
import { APP_VERSION } from "../version.js";
import { detectInstallChannel, isCiEnv } from "./env.js";
import { ensureInstallId, resolveInstallIdPath } from "./identity.js";
import { redactProperties } from "./redaction.js";

const POSTHOG_HOST = process.env.AISLOP_POSTHOG_HOST ?? "https://eu.i.posthog.com";
const POSTHOG_KEY =
	process.env.AISLOP_POSTHOG_KEY ?? "phc_eY2cOMFva9q24GrWeOuvuVIOhCIdjOALxeAR3ItrqbJ";
const SCHEMA_VERSION = "v2";
const REQUEST_TIMEOUT_MS = 3000;

type EventName =
	| "cli_installed"
	| "cli_command_started"
	| "cli_command_completed"
	| "mcp_server_started"
	| "mcp_tool_called"
	| "hook_scan_completed";

export interface TelemetryConfig {
	enabled?: boolean;
}

export const isTelemetryDisabled = (config?: TelemetryConfig): boolean => {
	const env = process.env;
	if (env.AISLOP_NO_TELEMETRY === "1" || env.DO_NOT_TRACK === "1") return true;
	if (config?.enabled === false) return true;
	if (config?.enabled === true) return false;
	if (env.CI === "true" || env.CI === "1") return true;
	return false;
};

const isDebug = (): boolean => process.env.AISLOP_TELEMETRY_DEBUG === "1";

const pendingRequests = new Set<Promise<unknown>>();
let cachedInstallId: string | null = null;
let installCreated = false;

const baseProperties = (installId: string): Record<string, unknown> => ({
	aislop_version: APP_VERSION,
	node_version: process.version,
	os: os.platform(),
	arch: os.arch(),
	schema_version: SCHEMA_VERSION,
	anonymous_install_id: installId,
	package_manager: detectInstallChannel(),
	is_ci: isCiEnv(),
});

interface TrackInput {
	event: EventName;
	properties?: Record<string, unknown>;
	config?: TelemetryConfig;
}

interface TrackResult {
	installCreated: boolean;
}

export const track = (input: TrackInput): TrackResult => {
	if (isTelemetryDisabled(input.config)) return { installCreated: false };

	if (cachedInstallId == null) {
		const ensured = ensureInstallId(resolveInstallIdPath());
		cachedInstallId = ensured.installId;
		installCreated = ensured.created;
	}

	const merged = { ...baseProperties(cachedInstallId), ...input.properties };
	const { clean, dropped } = redactProperties(merged);

	if (isDebug()) {
		const compact = JSON.stringify({ event: input.event, properties: clean });
		process.stderr.write(`[telemetry] ${compact}\n`);
		if (dropped.length > 0) {
			for (const key of dropped) {
				process.stderr.write(`[telemetry] dropped non-allowlisted property: ${key}\n`);
			}
		}
	}

	if (process.env.AISLOP_TELEMETRY_DRY_RUN === "1") {
		return { installCreated };
	}

	const payload = {
		api_key: POSTHOG_KEY,
		event: input.event,
		distinct_id: cachedInstallId,
		properties: clean,
		timestamp: new Date().toISOString(),
	};

	const request = fetch(`${POSTHOG_HOST}/capture/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	})
		.then(() => {})
		.catch(() => {})
		.finally(() => {
			pendingRequests.delete(request);
		});

	pendingRequests.add(request);
	return { installCreated };
};

export const flushTelemetry = async (timeoutMs?: number): Promise<void> => {
	if (pendingRequests.size === 0) return;
	const all = Promise.all(pendingRequests);
	if (timeoutMs == null) {
		await all;
		return;
	}
	// Bounded flush for latency-sensitive callers (per-edit hooks): give the
	// in-flight request a brief window, but never block the caller past the cap.
	await Promise.race([all, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
};

export const resetTelemetryForTests = (): void => {
	cachedInstallId = null;
	installCreated = false;
	pendingRequests.clear();
};
