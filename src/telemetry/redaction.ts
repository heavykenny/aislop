const SAFE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
	"aislop_version",
	"node_version",
	"os",
	"arch",
	"schema_version",
	"anonymous_install_id",
	"package_manager",
	"is_ci",

	"command",
	"language_summary",
	"lang_typescript",
	"lang_javascript",
	"lang_python",
	"lang_java",
	"file_count_bucket",

	"exit_code",
	"duration_ms",
	"error_kind",
	"score",
	"score_bucket",
	"finding_count",
	"error_count",
	"warning_count",
	"fixable_count",
	"fix_steps",
	"fix_resolved",
	"fix_score_delta",
	"score_before",
	"score_after",
	"changed_files",
	"provider_passes",
	"tool_calls",
	"output_events",
	"total_tokens",
	"cost_usd",
	"applied",
	"published",
	"target_met",

	"engine_format_issues",
	"engine_format_ms",
	"engine_lint_issues",
	"engine_lint_ms",
	"engine_code_quality_issues",
	"engine_code_quality_ms",
	"engine_ai_slop_issues",
	"engine_ai_slop_ms",
	"engine_architecture_issues",
	"engine_architecture_ms",
	"engine_security_issues",
	"engine_security_ms",

	"tool",
	"ok",

	"agent",
	"provider",
	"provider_source",
	"target_score",
	"max_turns",
	"finding_limit",
	"worktree_mode",
	"apply_requested",
	"dry_run",
	"background",
	"no_fix",
	"publish_mode",
	"ready_pr",
	"keep_worktree",
	"cleanup_requested",
	"confirmed_noninteractive",
	"provider_supplied",
	"result_limit",
	"custom_root",
	"interval_ms",
	"debounce_ms",
	"once",
	"repair",
	"force",
	"session_supplied",
	"monitor_supplied",
	"agent_result",
	"score_delta",
]);

interface RedactionResult {
	clean: Record<string, unknown>;
	dropped: string[];
}

export const redactProperties = (props: Record<string, unknown>): RedactionResult => {
	const clean: Record<string, unknown> = {};
	const dropped: string[] = [];
	for (const [key, value] of Object.entries(props)) {
		if (value === undefined) continue;
		if (SAFE_PROPERTY_NAMES.has(key)) {
			clean[key] = value;
		} else {
			dropped.push(key);
		}
	}
	return { clean, dropped };
};
