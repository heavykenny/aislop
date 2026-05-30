import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isCiEnv } from "./telemetry/env.js";
import { APP_VERSION } from "./version.js";

const REGISTRY_URL = "https://registry.npmjs.org/aislop/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2000;
const CACHE_BASENAME = "update_check.json";

export const isUpdateNotifierDisabled = (env: NodeJS.ProcessEnv = process.env): boolean => {
	if (env.AISLOP_NO_UPDATE_NOTIFIER === "1") return true;
	if (env.NO_UPDATE_NOTIFIER === "1") return true;
	if (env.DO_NOT_TRACK === "1") return true;
	return isCiEnv(env);
};

export const resolveUpdateCachePath = (
	homedir: string = os.homedir(),
	env: NodeJS.ProcessEnv = process.env,
): string => {
	if (process.platform === "linux" && env.XDG_STATE_HOME) {
		return path.join(env.XDG_STATE_HOME, "aislop", CACHE_BASENAME);
	}
	return path.join(homedir, ".aislop", CACHE_BASENAME);
};

interface VersionParts {
	major: number;
	minor: number;
	patch: number;
}

export const parseVersion = (raw: string): VersionParts | null => {
	const core = raw.trim().replace(/^v/, "").split(/[-+]/, 1)[0];
	const m = core.match(/^(\d+)\.(\d+)\.(\d+)$/);
	if (!m) return null;
	return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
};

export const isOutdated = (current: string, latest: string): boolean => {
	const c = parseVersion(current);
	const l = parseVersion(latest);
	if (!c || !l) return false;
	if (l.major !== c.major) return l.major > c.major;
	if (l.minor !== c.minor) return l.minor > c.minor;
	return l.patch > c.patch;
};

export const formatUpdateNotice = (current: string, latest: string): string =>
	`\nUpdate available: ${current} -> ${latest}. Run npx aislop@latest to upgrade.\n`;

interface UpdateCache {
	latest: string;
	checkedAt: number;
}

const readCache = (cachePath: string): UpdateCache | null => {
	try {
		const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
		if (typeof parsed?.latest === "string" && typeof parsed?.checkedAt === "number") {
			return { latest: parsed.latest, checkedAt: parsed.checkedAt };
		}
		return null;
	} catch {
		return null;
	}
};

const writeCache = (cachePath: string, cache: UpdateCache): boolean => {
	try {
		fs.mkdirSync(path.dirname(cachePath), { recursive: true });
		fs.writeFileSync(cachePath, JSON.stringify(cache));
		return true;
	} catch {
		return false;
	}
};

const fetchLatestVersion = async (): Promise<string | null> => {
	try {
		const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
		if (!res.ok) return null;
		const data = (await res.json()) as { version?: unknown };
		return typeof data.version === "string" ? data.version : null;
	} catch {
		return null;
	}
};

// Print from the cached latest version instantly, never blocking the user on the
// network, then refresh the cache in the same run when it is stale or missing.
export const maybeNotifyUpdate = async (now: number = Date.now()): Promise<void> => {
	if (isUpdateNotifierDisabled()) return;
	if (!process.stderr.isTTY) return;

	const cachePath = resolveUpdateCachePath();
	const cache = readCache(cachePath);

	if (cache && isOutdated(APP_VERSION, cache.latest)) {
		process.stderr.write(formatUpdateNotice(APP_VERSION, cache.latest));
	}

	if (!cache || now - cache.checkedAt > CHECK_INTERVAL_MS) {
		const latest = await fetchLatestVersion();
		if (latest) writeCache(cachePath, { latest, checkedAt: now });
	}
};
