import { fileCountBucket, scoreBucket } from "./env.js";
import { buildLanguageProperties } from "./language.js";

export type CommandName =
	| "scan"
	| "fix"
	| "ci"
	| "init"
	| "doctor"
	| "rules"
	| "badge"
	| "trend"
	| "agent"
	| "agent_plan"
	| "agent_providers"
	| "agent_connect"
	| "agent_use"
	| "agent_monitor"
	| "agent_monitor_list"
	| "agent_monitor_show"
	| "agent_monitor_stop"
	| "agent_sessions"
	| "agent_show"
	| "agent_apply"
	| "agent_watch"
	| "agent_stop"
	| "hook_install"
	| "hook_uninstall"
	| "hook_status"
	| "hook_baseline";

type ErrorKind = "config_invalid" | "engine_crash" | "timeout" | "unknown";

interface CommandStartedInput {
	command: CommandName;
	languages?: ReadonlyArray<string>;
	fileCount?: number;
	properties?: Record<string, unknown>;
}

export const buildCommandStartedProps = (input: CommandStartedInput): Record<string, unknown> => {
	const props: Record<string, unknown> = { ...input.properties, command: input.command };
	if (input.languages) Object.assign(props, buildLanguageProperties(input.languages));
	if (typeof input.fileCount === "number")
		props.file_count_bucket = fileCountBucket(input.fileCount);
	return props;
};

export interface EngineCounts {
	format?: number;
	lint?: number;
	"code-quality"?: number;
	"ai-slop"?: number;
	architecture?: number;
	security?: number;
}

const ENGINE_KEY_MAP: Record<string, string> = {
	format: "engine_format",
	lint: "engine_lint",
	"code-quality": "engine_code_quality",
	"ai-slop": "engine_ai_slop",
	architecture: "engine_architecture",
	security: "engine_security",
};

const flattenEngineStats = (
	issues: EngineCounts,
	timings: EngineCounts,
): Record<string, number> => {
	const out: Record<string, number> = {};
	for (const [engine, count] of Object.entries(issues)) {
		const key = ENGINE_KEY_MAP[engine];
		if (key != null && typeof count === "number") out[`${key}_issues`] = count;
	}
	for (const [engine, ms] of Object.entries(timings)) {
		const key = ENGINE_KEY_MAP[engine];
		if (key != null && typeof ms === "number") out[`${key}_ms`] = Math.round(ms);
	}
	return out;
};

interface CommandCompletedInput {
	startProps: Record<string, unknown>;
	exitCode: number;
	durationMs: number;
	errorKind?: ErrorKind;
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
	properties?: Record<string, unknown>;
}

export const buildCommandCompletedProps = (
	input: CommandCompletedInput,
): Record<string, unknown> => {
	const props: Record<string, unknown> = {
		...input.startProps,
		...input.properties,
		exit_code: input.exitCode,
		duration_ms: Math.round(input.durationMs),
	};
	if (input.errorKind) props.error_kind = input.errorKind;
	if (typeof input.score === "number") {
		props.score = input.score;
		props.score_bucket = scoreBucket(input.score);
	}
	if (typeof input.findingCount === "number") props.finding_count = input.findingCount;
	if (typeof input.errorCount === "number") props.error_count = input.errorCount;
	if (typeof input.warningCount === "number") props.warning_count = input.warningCount;
	if (typeof input.fixableCount === "number") props.fixable_count = input.fixableCount;
	if (input.engineIssues && input.engineTimings) {
		Object.assign(props, flattenEngineStats(input.engineIssues, input.engineTimings));
	}
	if (typeof input.fixSteps === "number") props.fix_steps = input.fixSteps;
	if (typeof input.fixResolved === "number") props.fix_resolved = input.fixResolved;
	if (typeof input.fixScoreDelta === "number") props.fix_score_delta = input.fixScoreDelta;
	return props;
};

interface McpToolCalledInput {
	tool: "aislop_scan" | "aislop_fix" | "aislop_why" | "aislop_baseline";
	durationMs: number;
	ok: boolean;
	errorKind?: ErrorKind;
}

export const buildMcpToolCalledProps = (input: McpToolCalledInput): Record<string, unknown> => {
	const props: Record<string, unknown> = {
		tool: input.tool,
		duration_ms: Math.round(input.durationMs),
		ok: input.ok,
	};
	if (input.errorKind) props.error_kind = input.errorKind;
	return props;
};

interface HookScanCompletedInput {
	agent: "claude" | "cursor" | "gemini" | "pi";
	score: number;
	scoreDelta?: number | null;
	findingCount: number;
	fileCount: number;
}

export const buildHookScanCompletedProps = (
	input: HookScanCompletedInput,
): Record<string, unknown> => {
	const props: Record<string, unknown> = {
		agent: input.agent,
		score: input.score,
		score_bucket: scoreBucket(input.score),
		finding_count: input.findingCount,
		file_count_bucket: fileCountBucket(input.fileCount),
	};
	if (typeof input.scoreDelta === "number") props.score_delta = input.scoreDelta;
	return props;
};

export const errorKindFromException = (error: unknown): ErrorKind => {
	const message =
		error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	if (message.includes("timeout") || message.includes("timed out")) return "timeout";
	if (message.includes("invalid config") || message.includes("config_invalid"))
		return "config_invalid";
	if (message.includes("engine") && message.includes("crash")) return "engine_crash";
	return "unknown";
};
