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
