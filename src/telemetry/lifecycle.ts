import { performance } from "node:perf_hooks";
import { flushTelemetry, track, type TelemetryConfig } from "./client.js";
import {
	buildCommandCompletedProps,
	buildCommandStartedProps,
	type CommandName,
	type EngineCounts,
	errorKindFromException,
} from "./events.js";

interface CommandLifecycleStart {
	command: CommandName;
	config?: TelemetryConfig;
	languages?: ReadonlyArray<string>;
	fileCount?: number;
}

interface CommandCompletionInfo {
	exitCode: number;
	score?: number;
	findingCount?: number;
	errorCount?: number;
	warningCount?: number;
	fixableCount?: number;
	engineIssues?: EngineCounts;
	engineTimings?: EngineCounts;
	fixSteps?: number;
	fixResolved?: number;
	fixScoreDelta?: number;
}

export const withCommandLifecycle = async <T extends CommandCompletionInfo>(
	start: CommandLifecycleStart,
	run: () => Promise<T>,
): Promise<T> => {
	const startProps = buildCommandStartedProps({
		command: start.command,
		languages: start.languages,
		fileCount: start.fileCount,
	});

	track({
		event: "cli_command_started",
		properties: startProps,
		config: start.config,
	});

	const startedAt = performance.now();

	try {
		const result = await run();
		const durationMs = performance.now() - startedAt;
		track({
			event: "cli_command_completed",
			properties: buildCommandCompletedProps({
				startProps,
				exitCode: result.exitCode,
				durationMs,
				score: result.score,
				findingCount: result.findingCount,
				errorCount: result.errorCount,
				warningCount: result.warningCount,
				fixableCount: result.fixableCount,
				engineIssues: result.engineIssues,
				engineTimings: result.engineTimings,
				fixSteps: result.fixSteps,
				fixResolved: result.fixResolved,
				fixScoreDelta: result.fixScoreDelta,
			}),
			config: start.config,
		});
		await flushTelemetry();
		return result;
	} catch (error) {
		const durationMs = performance.now() - startedAt;
		track({
			event: "cli_command_completed",
			properties: buildCommandCompletedProps({
				startProps,
				exitCode: 1,
				durationMs,
				errorKind: errorKindFromException(error),
			}),
			config: start.config,
		});
		await flushTelemetry();
		throw error;
	}
};
