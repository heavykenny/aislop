import os from "node:os";
import { APP_VERSION } from "../version.js";

/**
 * Anonymous, opt-out telemetry for aislop.
 *
 * What we collect:
 *   - Command run (scan, fix, ci)
 *   - Languages detected in the project
 *   - Score bucket (0-25, 25-50, 50-75, 75-100)
 *   - Issue counts per engine (not file paths or code)
 *   - Engine timing (milliseconds)
 *   - OS, architecture, and Node version
 *   - aislop version
 *
 * What we never collect:
 *   - File paths, file contents, or code snippets
 *   - Project names or directory paths
 *   - Git remotes, branch names, or commit hashes
 *   - Environment variables or secrets
 *   - IP addresses are not stored (PostHog configured to discard)
 *
 * How to opt out (any one of these):
 *   - Set AISLOP_NO_TELEMETRY=1
 *   - Set DO_NOT_TRACK=1 (https://consoledonottrack.com)
 *   - Set CI=true (telemetry is off in CI by default)
 *   - Set telemetry.enabled: false in .aislop/config.yml
 */

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

/**
 * Returns a stable anonymous device ID derived from hostname + OS.
 * This is NOT personally identifiable — it's a hash used only to
 * count unique devices, not to identify users.
 */
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

/**
 * Fire-and-forget telemetry event to PostHog.
 * Never throws, never blocks CLI output.
 * The request is kept alive via `flushTelemetry()` so Node doesn't
 * exit before it completes.
 */
export const trackEvent = (event: TelemetryEvent): void => {
	// Validate that we have an API key configured
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

/**
 * Wait for any pending telemetry request to complete.
 * Call this before `process.exit()` to ensure the event is delivered.
 * Times out after 3 seconds so it never hangs the CLI.
 */
export const flushTelemetry = async (): Promise<void> => {
	if (pendingRequest) {
		await pendingRequest;
		pendingRequest = null;
	}
};

export { getScoreBucket };
