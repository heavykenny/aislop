// aislop-ignore-file duplicate-block
import path from "node:path";
import { AISLOP_MD_BODY } from "../assets.js";
import { readIfExists } from "../io/atomic-write.js";
import { AISLOP_SENTINEL_KEY, removeAislopEntries, upsertHookGroup } from "../io/json-patch.js";
import { sentinelHash, upsertMarkdownFence } from "../io/sentinel.js";
import {
	applyContent,
	applyRemoval,
	emptyResult,
	type HookInstallOpts,
	type HookInstallResult,
	type HookUninstallResult,
} from "./types.js";

interface ClaudePaths {
	settings: string;
	aislopMd: string;
	claudeMd: string;
}

export const resolveClaudePaths = (opts: HookInstallOpts): ClaudePaths => {
	const root =
		opts.scope === "project" ? path.join(opts.cwd, ".claude") : path.join(opts.home, ".claude");
	return {
		settings: path.join(root, "settings.json"),
		aislopMd: path.join(root, "AISLOP.md"),
		claudeMd: path.join(root, "CLAUDE.md"),
	};
};

const buildHookGroup = () => {
	const hashBody = JSON.stringify({
		command: "aislop hook claude",
		matcher: "Edit|Write|MultiEdit",
	});
	return {
		matcher: "Edit|Write|MultiEdit",
		hooks: [
			{
				type: "command",
				command: "aislop hook claude",
				[AISLOP_SENTINEL_KEY]: {
					v: 1,
					managed: true,
					hash: sentinelHash(hashBody),
				},
			},
		],
	};
};

const buildStopHookGroup = () => {
	const hashBody = JSON.stringify({ command: "aislop hook claude --stop" });
	return {
		matcher: "",
		hooks: [
			{
				type: "command",
				command: "aislop hook claude --stop",
				[AISLOP_SENTINEL_KEY]: {
					v: 1,
					managed: true,
					hash: sentinelHash(hashBody),
				},
			},
		],
	};
};

const renderSettings = (existingRaw: string | null, qualityGate: boolean): string => {
	let obj: Record<string, unknown> = {};
	if (existingRaw) {
		try {
			obj = JSON.parse(existingRaw) as Record<string, unknown>;
		} catch {
			obj = {};
		}
	}
	let next = upsertHookGroup(obj, "PostToolUse", buildHookGroup());
	if (qualityGate) next = upsertHookGroup(next, "Stop", buildStopHookGroup());
	else next = removeAislopEntries(next, "Stop").next;
	return `${JSON.stringify(next, null, 2)}\n`;
};

export const installClaude = (opts: HookInstallOpts): HookInstallResult => {
	const paths = resolveClaudePaths(opts);
	const result = emptyResult();

	const nextSettings = renderSettings(readIfExists(paths.settings), Boolean(opts.qualityGate));
	applyContent(result, opts, paths.settings, nextSettings, "register PostToolUse hook");

	const mdHash = sentinelHash(AISLOP_MD_BODY);
	const existingMd = readIfExists(paths.aislopMd);
	const fenced = upsertMarkdownFence(existingMd, AISLOP_MD_BODY, mdHash);
	applyContent(result, opts, paths.aislopMd, fenced.nextContent, "write AISLOP.md rules");

	const existingClaudeMd = readIfExists(paths.claudeMd) ?? "";
	const marker = "@AISLOP.md";
	if (!existingClaudeMd.includes(marker)) {
		const joiner = existingClaudeMd.endsWith("\n") || existingClaudeMd.length === 0 ? "" : "\n";
		const prefix = existingClaudeMd.length === 0 ? "" : `${existingClaudeMd}${joiner}\n`;
		applyContent(
			result,
			opts,
			paths.claudeMd,
			`${prefix}${marker}\n`,
			"append @AISLOP.md reference",
		);
	} else {
		result.skipped.push(paths.claudeMd);
	}

	return result;
};

export const uninstallClaude = (
	opts: Omit<HookInstallOpts, "qualityGate">,
): HookUninstallResult => {
	const paths = resolveClaudePaths({ ...opts, qualityGate: false });
	const result: HookUninstallResult = { removed: [], skipped: [] };

	const settingsRaw = readIfExists(paths.settings);
	if (settingsRaw) {
		let obj: Record<string, unknown> = {};
		try {
			obj = JSON.parse(settingsRaw) as Record<string, unknown>;
		} catch {
			obj = {};
		}
		const stripped = removeAislopEntries(removeAislopEntries(obj, "PostToolUse").next, "Stop").next;
		const stillHasHooks =
			stripped.hooks &&
			typeof stripped.hooks === "object" &&
			Object.keys(stripped.hooks as object).length > 0;
		const otherKeys = Object.keys(stripped).filter((k) => k !== "hooks");
		if (!stillHasHooks && otherKeys.length === 0) {
			applyRemoval(result, opts, paths.settings, null);
		} else {
			applyRemoval(result, opts, paths.settings, `${JSON.stringify(stripped, null, 2)}\n`);
		}
	} else {
		result.skipped.push(paths.settings);
	}

	const existingMd = readIfExists(paths.aislopMd);
	if (existingMd != null) {
		applyRemoval(result, opts, paths.aislopMd, null);
	} else {
		result.skipped.push(paths.aislopMd);
	}

	const claudeMd = readIfExists(paths.claudeMd);
	if (claudeMd != null && claudeMd.includes("@AISLOP.md")) {
		const stripped = claudeMd
			.split("\n")
			.filter((line) => line.trim() !== "@AISLOP.md")
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
		applyRemoval(result, opts, paths.claudeMd, stripped.length === 0 ? null : `${stripped}\n`);
	} else {
		result.skipped.push(paths.claudeMd);
	}

	return result;
};
