import path from "node:path";
import { AISLOP_MD_BODY } from "../assets.js";
import { readIfExists } from "../io/atomic-write.js";
import { AISLOP_SENTINEL_KEY, removeAislopEntries, upsertFlatHook } from "../io/json-patch.js";
import { sentinelHash, upsertMarkdownFence } from "../io/sentinel.js";
import {
	applyContent,
	applyRemoval,
	emptyResult,
	type HookInstallOpts,
	type HookInstallResult,
	type HookUninstallResult,
} from "./types.js";

interface CursorPaths {
	hooks: string;
	rules: string;
}

export const resolveCursorPaths = (opts: HookInstallOpts): CursorPaths => {
	const root =
		opts.scope === "project" ? path.join(opts.cwd, ".cursor") : path.join(opts.home, ".cursor");
	return {
		hooks: path.join(root, "hooks.json"),
		// Rules file only makes sense per-project (Cursor picks it up from the working repo)
		rules: path.join(opts.cwd, ".cursor", "rules", "aislop.mdc"),
	};
};

const buildHookEntry = () => {
	const hashBody = JSON.stringify({ command: "aislop hook cursor", timeout: 5000 });
	return {
		command: "aislop hook cursor",
		type: "command",
		timeout: 5000,
		[AISLOP_SENTINEL_KEY]: {
			v: 1,
			managed: true,
			hash: sentinelHash(hashBody),
		},
	};
};

const renderHooksJson = (existingRaw: string | null): string => {
	let obj: Record<string, unknown> = { version: 1 };
	if (existingRaw) {
		try {
			obj = JSON.parse(existingRaw) as Record<string, unknown>;
		} catch {
			obj = { version: 1 };
		}
	}
	if (typeof obj.version !== "number") obj.version = 1;
	const next = upsertFlatHook(obj, "afterFileEdit", buildHookEntry());
	return `${JSON.stringify(next, null, 2)}\n`;
};

export const installCursor = (opts: HookInstallOpts): HookInstallResult => {
	const paths = resolveCursorPaths(opts);
	const result = emptyResult();

	const nextHooks = renderHooksJson(readIfExists(paths.hooks));
	applyContent(result, opts, paths.hooks, nextHooks, "register afterFileEdit hook");

	if (opts.scope === "project") {
		const existingRules = readIfExists(paths.rules);
		const hash = sentinelHash(AISLOP_MD_BODY);
		const rules = upsertMarkdownFence(existingRules, AISLOP_MD_BODY, hash).nextContent;
		applyContent(result, opts, paths.rules, rules, "write .cursor/rules/aislop.mdc");
	}

	return result;
};

export const uninstallCursor = (
	opts: Omit<HookInstallOpts, "qualityGate">,
): HookUninstallResult => {
	const paths = resolveCursorPaths(opts);
	const result: HookUninstallResult = { removed: [], skipped: [] };

	const raw = readIfExists(paths.hooks);
	if (raw) {
		let obj: Record<string, unknown> = {};
		try {
			obj = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			obj = {};
		}
		const stripped = removeAislopEntries(obj, "afterFileEdit").next;
		const stillHasHooks =
			stripped.hooks &&
			typeof stripped.hooks === "object" &&
			Object.keys(stripped.hooks as object).length > 0;
		const otherKeys = Object.keys(stripped).filter((k) => k !== "hooks" && k !== "version");
		if (!stillHasHooks && otherKeys.length === 0) {
			applyRemoval(result, opts, paths.hooks, null);
		} else {
			applyRemoval(result, opts, paths.hooks, `${JSON.stringify(stripped, null, 2)}\n`);
		}
	} else {
		result.skipped.push(paths.hooks);
	}

	if (opts.scope === "project") {
		applyRemoval(result, opts, paths.rules, null);
	}

	return result;
};
