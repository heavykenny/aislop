import type { Diagnostic } from "../types.js";
import { slop } from "./dead-pattern-diagnostic.js";
import { JS_EXTENSIONS } from "./dead-pattern-languages.js";
import { isNonProductionPath } from "./non-production-paths.js";

const CONSOLE_CALL_PATTERN = /\bconsole\.(log|debug|info|trace|dir|table)\s*\(/;
const LOGGER_FILE_PATTERN = /(?:^|\/)(?:logger|logging|log)\.[^/]+$/i;
const CLI_ENTRYPOINT_PATTERN = /(?:^|\/)(?:cli|cli[-_.][^/]*|[^/]+[-_]cli)\.[mc]?[jt]sx?$/i;
const ENTRYPOINT_GUARD_PATTERN = /\b(?:import\.meta\.main|require\.main\s*===\s*module)\b/;
const OPERATIONAL_LOG_PATTERN = /\bconsole\.(?:log|info)\s*\(\s*(?:`|["'])\s*\[[^\]\n]{1,48}\]/;
const DEBUG_SIGNAL_PATTERN =
	/\b(?:debug|dbg|trace|dump|inspect|todo|tmp|temp|remove\s+me|leftover|here|checkpoint)\b/i;

const shouldFlagConsoleCall = (trimmed: string): boolean => {
	const match = CONSOLE_CALL_PATTERN.exec(trimmed);
	if (!match) return false;
	const method = match[1];
	if (method === "trace" || method === "dir" || method === "table") return true;
	if (method === "debug")
		return DEBUG_SIGNAL_PATTERN.test(trimmed) || !OPERATIONAL_LOG_PATTERN.test(trimmed);
	if (method === "info" || method === "log") {
		if (/console\.log\(\s*JSON\.stringify\b/.test(trimmed)) return false;
		if (OPERATIONAL_LOG_PATTERN.test(trimmed)) return false;
		return true;
	}
	return false;
};

export const detectConsoleLeftovers = (
	content: string,
	relativePath: string,
	ext: string,
): Diagnostic[] => {
	if (!JS_EXTENSIONS.has(ext)) return [];

	if (LOGGER_FILE_PATTERN.test(relativePath)) return [];
	if (isNonProductionPath(relativePath) || CLI_ENTRYPOINT_PATTERN.test(relativePath)) return [];
	if (content.startsWith("#!")) return [];
	if (ENTRYPOINT_GUARD_PATTERN.test(content)) return [];

	const diagnostics: Diagnostic[] = [];
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

		if (shouldFlagConsoleCall(trimmed)) {
			diagnostics.push(
				slop(
					relativePath,
					i + 1,
					"ai-slop/console-leftover",
					"warning",
					"console.log/debug/info statement left in production code",
					"Remove debugging console statements or replace with a proper logger",
					true,
				),
			);
		}
	}

	return diagnostics;
};
