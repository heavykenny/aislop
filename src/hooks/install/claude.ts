import os from "node:os";
import path from "node:path";
import { AISLOP_MD_BODY } from "../assets.js";
import { atomicWrite, readIfExists } from "../io/atomic-write.js";
import { AISLOP_SENTINEL_KEY, upsertHookGroup } from "../io/json-patch.js";
import { sentinelHash, upsertMarkdownFence } from "../io/sentinel.js";

interface ClaudePaths {
	settings: string;
	aislopMd: string;
	claudeMd: string;
}

interface ClaudeInstallTargets {
	home: string;
}

interface ClaudeInstallResult {
	wrote: string[];
	skipped: string[];
}

export const resolveClaudePaths = (home: string): ClaudePaths => ({
	settings: path.join(home, ".claude", "settings.json"),
	aislopMd: path.join(home, ".claude", "AISLOP.md"),
	claudeMd: path.join(home, ".claude", "CLAUDE.md"),
});

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

export const installClaude = (
	opts: ClaudeInstallTargets = { home: os.homedir() },
): ClaudeInstallResult => {
	const paths = resolveClaudePaths(opts.home);
	const wrote: string[] = [];
	const skipped: string[] = [];

	const existingSettingsRaw = readIfExists(paths.settings);
	let settingsObj: Record<string, unknown> = {};
	if (existingSettingsRaw) {
		try {
			settingsObj = JSON.parse(existingSettingsRaw) as Record<string, unknown>;
		} catch {
			// Back up a corrupt settings.json so the user can recover manually.
			atomicWrite(`${paths.settings}.aislop-bak`, existingSettingsRaw);
		}
	}
	const nextSettings = upsertHookGroup(settingsObj, "PostToolUse", buildHookGroup());
	const nextSettingsStr = `${JSON.stringify(nextSettings, null, 2)}\n`;
	if (nextSettingsStr !== existingSettingsRaw) {
		atomicWrite(paths.settings, nextSettingsStr);
		wrote.push(paths.settings);
	} else {
		skipped.push(paths.settings);
	}

	const mdHash = sentinelHash(AISLOP_MD_BODY);
	const existingMd = readIfExists(paths.aislopMd);
	const fenced = upsertMarkdownFence(existingMd, AISLOP_MD_BODY, mdHash);
	if (fenced.nextContent !== existingMd) {
		atomicWrite(paths.aislopMd, fenced.nextContent);
		wrote.push(paths.aislopMd);
	} else {
		skipped.push(paths.aislopMd);
	}

	const existingClaudeMd = readIfExists(paths.claudeMd) ?? "";
	const marker = "@AISLOP.md";
	if (!existingClaudeMd.includes(marker)) {
		const joiner = existingClaudeMd.endsWith("\n") || existingClaudeMd.length === 0 ? "" : "\n";
		const prefix = existingClaudeMd.length === 0 ? "" : `${existingClaudeMd}${joiner}\n`;
		const nextClaudeMd = `${prefix}${marker}\n`;
		atomicWrite(paths.claudeMd, nextClaudeMd);
		wrote.push(paths.claudeMd);
	} else {
		skipped.push(paths.claudeMd);
	}

	return { wrote, skipped };
};
