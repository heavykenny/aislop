import os from "node:os";
import { APP_VERSION } from "../version.js";

const POSTHOG_HOST = "https://eu.i.posthog.com";
const POSTHOG_KEY = "phc_eY2cOMFva9q24GrWeOuvuVIOhCIdjOALxeAR3ItrqbJ";

interface TelemetryEvent {
	command: "scan" | "fix" | "ci";
	languages?: string[];
	scoreBucket?: string;
	engineIssues?: Record<string, number>;
	engineTimings?: Record<string, number>;
	elapsedMs?: number;
	fileCount?: number;
	fixSteps?: number;
	fixResolved?: number;
}

/**
 * Returns true if telemetry should be disabled.
 * Telemetry is opt-out: it runs unless explicitly disabled.
 */
export const isTelemetryDisabled = (configEnabled?: boolean): boolean => {
	// Explicit env var opt-out
	if (process.env.AISLOP_NO_TELEMETRY === "1" || process.env.DO_NOT_TRACK === "1") {
		return true;
	}

	// CI environments: off by default
	if (process.env.CI === "true" || process.env.CI === "1") {
		return true;
	}

	// Config file opt-out
	if (configEnabled === false) {
		return true;
	}

	return false;
};

const getScoreBucket = (score: number): string => {
	if (score >= 75) return "75-100";
	if (score >= 50) return "50-75";
	if (score >= 25) return "25-50";
	return "0-25";
};

const getAnonymousId = (): string => {
	const raw = `${os.hostname()}-${os.platform()}-${os.arch()}`;
	// Simple djb2 hash — no crypto needed for anonymous bucketing
	let hash = 5381;
	for (let i = 0; i < raw.length; i++) {
		hash = (hash * 33) ^ raw.charCodeAt(i);
	}
	return `aislop_${(hash >>> 0).toString(36)}`;
};

/** Pending telemetry request — kept alive so Node doesn't exit before it completes. */
let pendingRequest: Promise<void> | null = null;

export const trackEvent = (event: TelemetryEvent): void => {
	if (!POSTHOG_KEY) {
		return;
	}

	const payload = {
		api_key: POSTHOG_KEY,
		event: `cli_${event.command}`,
		distinct_id: getAnonymousId(),
		properties: {
			version: APP_VERSION,
			node_version: process.version,
			os: os.platform(),
			arch: os.arch(),
			languages: event.languages,
			score_bucket: event.scoreBucket,
			engine_issues: event.engineIssues,
			engine_timings: event.engineTimings,
			elapsed_ms: event.elapsedMs,
			file_count: event.fileCount,
			fix_steps: event.fixSteps,
			fix_resolved: event.fixResolved,
		},
		timestamp: new Date().toISOString(),
	};

	pendingRequest = fetch(`${POSTHOG_HOST}/capture/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(3000),
	})
		.then(() => {})
		.catch(() => {
			// Silently ignore — telemetry must never affect the user experience
		});
};

export const flushTelemetry = async (): Promise<void> => {
	if (pendingRequest) {
		await pendingRequest;
		pendingRequest = null;
	}
};

export { getScoreBucket };
