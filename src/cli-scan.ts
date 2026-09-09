import { scanCommand } from "./commands/scan.js";
import { loadConfig } from "./config/index.js";
import { flushTelemetry } from "./telemetry/index.js";

export interface ScanFlags {
	changes?: boolean;
	staged?: boolean;
	base?: string;
	verbose?: boolean;
	json?: boolean;
	sarif?: boolean;
	format?: string;
	exclude?: string[];
	include?: string[];
}

export const commaSeparatedParser = (value: string, previous: string[] = []): string[] => {
	const parts = value
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
	return [...previous, ...parts];
};

const wantsSarif = (flags: ScanFlags): boolean => Boolean(flags.sarif) || flags.format === "sarif";

const wantsJson = (flags: ScanFlags): boolean => Boolean(flags.json) || flags.format === "json";

export const runScan = async (directory: string, flags: ScanFlags): Promise<void> => {
	const config = loadConfig(directory);
	const finalConfig = {
		...config,
		exclude: [...(config.exclude ?? []), ...(flags.exclude ?? [])],
		include: [...(config.include ?? []), ...(flags.include ?? [])],
	};
	const sarif = wantsSarif(flags);
	const { exitCode } = await scanCommand(directory, finalConfig, {
		changes: Boolean(flags.changes),
		staged: Boolean(flags.staged),
		base: flags.base,
		verbose: Boolean(flags.verbose),
		json: !sarif && wantsJson(flags),
		sarif,
		exclude: flags.exclude,
		include: flags.include,
	});
	if (exitCode !== 0) {
		await flushTelemetry();
		process.exitCode = exitCode;
	}
};

export const noFlagsPassed = (flags: ScanFlags): boolean =>
	!flags.changes &&
	!flags.staged &&
	!flags.verbose &&
	!flags.json &&
	!flags.sarif &&
	!flags.format &&
	!(flags.exclude && flags.exclude.length > 0) &&
	!(flags.include && flags.include.length > 0);
