import path from "node:path";
import type { SlopConfig } from "../config/index.js";
import { fixBiomeFormat } from "../engines/format/biome.js";
import { fixGofmt } from "../engines/format/gofmt.js";
import { fixRuffFormat } from "../engines/format/ruff-format.js";
import { fixRuffLint } from "../engines/lint/ruff.js";
import { discoverProject } from "../utils/discover.js";
import { logger } from "../utils/logger.js";
import { spinner } from "../utils/spinner.js";

export const fixCommand = async (
	directory: string,
	config: SlopConfig,
): Promise<void> => {
	const resolvedDir = path.resolve(directory);

	logger.log(`slop fix v${process.env.VERSION ?? "0.1.0"}`);
	logger.break();

	const projectInfo = await discoverProject(resolvedDir);

	// Format fixes
	if (config.engines.format) {
		if (
			projectInfo.languages.includes("typescript") ||
			projectInfo.languages.includes("javascript")
		) {
			const s = spinner("Fixing JS/TS formatting...").start();
			try {
				await fixBiomeFormat(resolvedDir);
				s.succeed("Fixed JS/TS formatting");
			} catch {
				s.fail("Failed to fix JS/TS formatting");
			}
		}

		if (
			projectInfo.languages.includes("python") &&
			projectInfo.installedTools["ruff"]
		) {
			const s = spinner("Fixing Python formatting...").start();
			try {
				await fixRuffFormat(resolvedDir);
				s.succeed("Fixed Python formatting");
			} catch {
				s.fail("Failed to fix Python formatting");
			}
		}

		if (projectInfo.languages.includes("go")) {
			const s = spinner("Fixing Go formatting...").start();
			try {
				await fixGofmt(resolvedDir);
				s.succeed("Fixed Go formatting");
			} catch {
				s.fail("Failed to fix Go formatting");
			}
		}
	}

	// Lint fixes
	if (config.engines.lint) {
		if (
			projectInfo.languages.includes("python") &&
			projectInfo.installedTools["ruff"]
		) {
			const s = spinner("Fixing Python lint issues...").start();
			try {
				await fixRuffLint(resolvedDir);
				s.succeed("Fixed Python lint issues");
			} catch {
				s.fail("Failed to fix Python lint issues");
			}
		}
	}

	logger.break();
	logger.success("  Done! Run `slop scan` to verify.");
	logger.break();
};
