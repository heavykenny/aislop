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

interface GeminiPaths {
	settings: string;
	aislopMd: string;
	geminiMd: string;
}

export const resolveGeminiPaths = (opts: HookInstallOpts): GeminiPaths => {
	const root =
		opts.scope === "project" ? path.join(opts.cwd, ".gemini") : path.join(opts.home, ".gemini");
	return {
		settings: path.join(root, "settings.json"),
		aislopMd: path.join(root, "AISLOP.md"),
		geminiMd: path.join(root, "GEMINI.md"),
	};
};

const buildHookGroup = () => {
	const hashBody = JSON.stringify({
		command: "aislop hook gemini",
		matcher: "write_file|replace",
	});
	return {
		matcher: "write_file|replace",
		hooks: [
			{
				name: "aislop",
				type: "command",
				command: "aislop hook gemini",
				timeout: 5000,
				[AISLOP_SENTINEL_KEY]: {
					v: 1,
					managed: true,
					hash: sentinelHash(hashBody),
				},
			},
		],
	};
};

const renderSettings = (existingRaw: string | null): string => {
	let obj: Record<string, unknown> = {};
	if (existingRaw) {
		try {
			obj = JSON.parse(existingRaw) as Record<string, unknown>;
		} catch {
			obj = {};
		}
	}
	const next = upsertHookGroup(obj, "AfterTool", buildHookGroup());
	return `${JSON.stringify(next, null, 2)}\n`;
};

export const installGemini = (opts: HookInstallOpts): HookInstallResult => {
	const paths = resolveGeminiPaths(opts);
	const result = emptyResult();

	const next = renderSettings(readIfExists(paths.settings));
	applyContent(result, opts, paths.settings, next, "register AfterTool hook");

	const existingMd = readIfExists(paths.aislopMd);
	const hash = sentinelHash(AISLOP_MD_BODY);
	const fenced = upsertMarkdownFence(existingMd, AISLOP_MD_BODY, hash).nextContent;
	applyContent(result, opts, paths.aislopMd, fenced, "write AISLOP.md rules");

	const existingGeminiMd = readIfExists(paths.geminiMd) ?? "";
	const marker = "@AISLOP.md";
	if (!existingGeminiMd.includes(marker)) {
		const joiner = existingGeminiMd.endsWith("\n") || existingGeminiMd.length === 0 ? "" : "\n";
		const prefix = existingGeminiMd.length === 0 ? "" : `${existingGeminiMd}${joiner}\n`;
		applyContent(
			result,
			opts,
			paths.geminiMd,
			`${prefix}${marker}\n`,
			"append @AISLOP.md reference",
		);
	} else {
		result.skipped.push(paths.geminiMd);
	}

	return result;
};

export const uninstallGemini = (
	opts: Omit<HookInstallOpts, "qualityGate">,
): HookUninstallResult => {
	const paths = resolveGeminiPaths(opts);
	const result: HookUninstallResult = { removed: [], skipped: [] };

	const raw = readIfExists(paths.settings);
	if (raw) {
		let obj: Record<string, unknown> = {};
		try {
			obj = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			obj = {};
		}
		const stripped = removeAislopEntries(obj, "AfterTool").next;
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

	const md = readIfExists(paths.aislopMd);
	if (md != null) applyRemoval(result, opts, paths.aislopMd, null);
	else result.skipped.push(paths.aislopMd);

	const geminiMd = readIfExists(paths.geminiMd);
	if (geminiMd != null && geminiMd.includes("@AISLOP.md")) {
		const stripped = geminiMd
			.split("\n")
			.filter((l) => l.trim() !== "@AISLOP.md")
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
		applyRemoval(result, opts, paths.geminiMd, stripped.length === 0 ? null : `${stripped}\n`);
	} else {
		result.skipped.push(paths.geminiMd);
	}

	return result;
};
