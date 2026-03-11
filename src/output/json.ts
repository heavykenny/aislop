import type { Diagnostic, EngineResult } from "../engines/types.js";
import type { ScoreResult } from "../scoring/index.js";
import { APP_VERSION } from "../version.js";
import type { EngineInfo } from "./engine-info.js";
import { ENGINE_INFO } from "./engine-info.js";

interface JsonOutput {
	version: string;
	score: number;
	label: string;
	engines: Record<
		string,
		{ issues: number; skipped: boolean; elapsed: number }
	>;
	engineDefinitions: Record<string, EngineInfo>;
	diagnostics: Diagnostic[];
	summary: {
		errors: number;
		warnings: number;
		fixable: number;
		files: number;
		elapsed: string;
	};
}

export const buildJsonOutput = (
	results: EngineResult[],
	scoreResult: ScoreResult,
	fileCount: number,
	elapsedMs: number,
): JsonOutput => {
	const allDiagnostics = results.flatMap((r) => r.diagnostics);
	const engines: JsonOutput["engines"] = {};

	for (const result of results) {
		engines[result.engine] = {
			issues: result.diagnostics.length,
			skipped: result.skipped,
			elapsed: result.elapsed,
		};
	}

	return {
		version: APP_VERSION,
		score: scoreResult.score,
		label: scoreResult.label,
		engines,
		engineDefinitions: ENGINE_INFO,
		diagnostics: allDiagnostics,
		summary: {
			errors: allDiagnostics.filter((d) => d.severity === "error").length,
			warnings: allDiagnostics.filter((d) => d.severity === "warning").length,
			fixable: allDiagnostics.filter((d) => d.fixable).length,
			files: fileCount,
			elapsed:
				elapsedMs < 1000
					? `${Math.round(elapsedMs)}ms`
					: `${(elapsedMs / 1000).toFixed(1)}s`,
		},
	};
};
