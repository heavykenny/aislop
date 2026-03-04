import path from "node:path";
import type { SlopConfig } from "../config/index.js";
import { fixBiomeFormat, runBiomeFormat } from "../engines/format/biome.js";
import { fixGofmt, runGofmt } from "../engines/format/gofmt.js";
import { fixRuffFormat, runRuffFormat } from "../engines/format/ruff-format.js";
import { fixRuffLint, runRuffLint } from "../engines/lint/ruff.js";
import type { Diagnostic, EngineContext } from "../engines/types.js";
import { discoverProject } from "../utils/discover.js";
import { logger } from "../utils/logger.js";
import { spinner } from "../utils/spinner.js";

interface FixOptions {
	verbose: boolean;
}

const shouldUseSpinner = (): boolean =>
	Boolean(process.stderr.isTTY) &&
	process.env.CI !== "true" &&
	process.env.CI !== "1";

const uniqueFileCount = (diagnostics: Diagnostic[]): number =>
	new Set(diagnostics.map((d) => d.filePath)).size;

const printVerboseDiagnostics = (
	title: string,
	diagnostics: Diagnostic[],
): void => {
	if (diagnostics.length === 0) return;
	const files = [...new Set(diagnostics.map((d) => d.filePath))];
	logger.dim(`    ${title}: ${files.length} file(s)`);
	for (const file of files) {
		logger.dim(`      ${file}`);
	}
};

interface FixStepResult {
	beforeIssues: number;
	afterIssues: number;
	resolvedIssues: number;
	beforeFiles: number;
	afterFiles: number;
}

const runFixStep = async (
	name: string,
	detect: () => Promise<Diagnostic[]>,
	applyFix: () => Promise<void>,
	options: FixOptions,
): Promise<void> => {
	const useSpinner = shouldUseSpinner();
	const stepSpinner = useSpinner ? spinner(`Fixing ${name}...`).start() : null;

	try {
		const before = await detect();
		await applyFix();
		const after = await detect();

		const summary: FixStepResult = {
			beforeIssues: before.length,
			afterIssues: after.length,
			resolvedIssues: Math.max(0, before.length - after.length),
			beforeFiles: uniqueFileCount(before),
			afterFiles: uniqueFileCount(after),
		};

		let message: string;
		if (summary.beforeIssues === 0) {
			message = `${name}: already clean (0 issues)`;
		} else if (summary.afterIssues === 0) {
			message = `${name}: fixed all issues (${summary.beforeIssues} -> 0 across ${summary.beforeFiles} file(s))`;
		} else {
			message = `${name}: partially fixed (${summary.beforeIssues} -> ${summary.afterIssues}, resolved ${summary.resolvedIssues})`;
		}

		if (stepSpinner) {
			stepSpinner.succeed(message);
		} else {
			logger.success(`  ${message}`);
		}

		if (options.verbose) {
			printVerboseDiagnostics("Detected before fix", before);
			printVerboseDiagnostics("Still remaining", after);
		}
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = `${name}: failed`;
    const firstLine = reason.split("\n").find((line) => line.trim().length > 0) ?? reason;
    const reasonToPrint = options.verbose ? reason : firstLine;
    if (stepSpinner) {
      stepSpinner.fail(message);
    } else {
      logger.error(`  ${message}`);
    }
    logger.dim(`    ${reasonToPrint}`);
    if (!options.verbose && reason !== reasonToPrint) {
      logger.dim("    Re-run with -d for full tool output.");
    }
  }
};

const createEngineContext = (
	rootDirectory: string,
	projectInfo: Awaited<ReturnType<typeof discoverProject>>,
	config: SlopConfig,
): EngineContext => ({
	rootDirectory,
	languages: projectInfo.languages,
	frameworks: projectInfo.frameworks,
	installedTools: projectInfo.installedTools,
	config: {
		quality: config.quality,
		security: config.security,
	},
});

export const fixCommand = async (
	directory: string,
	config: SlopConfig,
	options: FixOptions = { verbose: false },
): Promise<void> => {
	const resolvedDir = path.resolve(directory);

	logger.log(`slop fix v${process.env.VERSION ?? "0.1.0"}`);
	logger.break();

	const projectInfo = await discoverProject(resolvedDir);
	const context = createEngineContext(resolvedDir, projectInfo, config);

	let stepsRun = 0;

  if (config.engines.format) {
		if (
			projectInfo.languages.includes("typescript") ||
			projectInfo.languages.includes("javascript")
		) {
			stepsRun++;
			await runFixStep(
				"JS/TS formatting",
				() => runBiomeFormat(context),
				() => fixBiomeFormat(resolvedDir),
				options,
			);
		}

    if (
      projectInfo.languages.includes("python") &&
      projectInfo.installedTools.ruff
    ) {
      stepsRun++;
      await runFixStep(
        "Python formatting",
        () => runRuffFormat(context),
        () => fixRuffFormat(resolvedDir),
        options,
      );
    } else if (projectInfo.languages.includes("python")) {
      logger.warn("  Python detected but ruff is not installed; skipping Python formatting fixes.");
    }

		if (projectInfo.languages.includes("go")) {
			stepsRun++;
			await runFixStep(
				"Go formatting",
				() => runGofmt(context),
				() => fixGofmt(resolvedDir),
				options,
			);
		}
	}

  if (config.engines.lint) {
    if (
      projectInfo.languages.includes("python") &&
      projectInfo.installedTools.ruff
    ) {
      stepsRun++;
      await runFixStep(
        "Python lint fixes",
        () => runRuffLint(context),
        () => fixRuffLint(resolvedDir),
        options,
      );
    } else if (projectInfo.languages.includes("python")) {
      logger.warn("  Python detected but ruff is not installed; skipping Python lint fixes.");
    }
  }

	if (stepsRun === 0) {
		logger.dim("  No applicable auto-fixers found for this project.");
	}

	logger.break();
	logger.success("  Done! Run `slop scan` to verify.");
	logger.break();
};
