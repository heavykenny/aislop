import type { Diagnostic, EngineResult } from "../engines/types.js";
import type { ScoreResult } from "../scoring/index.js";
import type { Coverage } from "../utils/discover.js";
import { APP_VERSION } from "../version.js";
import { ENGINE_INFO, type EngineInfo } from "./engine-info.js";

interface JsonOutput {
	schemaVersion: string;
	cliVersion: string;
	version: string;
	score: number | null;
	label: string;
	scoreable: boolean;
	coverage: Coverage;
	engines: Record<string, { issues: number; skipped: boolean; elapsed: number }>;
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
	coverage: Coverage,
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
		schemaVersion: "1",
		cliVersion: APP_VERSION,
		version: APP_VERSION,
		score: coverage.scoreable ? scoreResult.score : null,
		label: coverage.scoreable ? scoreResult.label : "not scored",
		scoreable: coverage.scoreable,
		coverage,
		engines,
		engineDefinitions: ENGINE_INFO,
		diagnostics: allDiagnostics,
		summary: {
			errors: allDiagnostics.filter((d) => d.severity === "error").length,
			warnings: allDiagnostics.filter((d) => d.severity === "warning").length,
			fixable: allDiagnostics.filter((d) => d.fixable).length,
			files: fileCount,
			elapsed:
				elapsedMs < 1000 ? `${Math.round(elapsedMs)}ms` : `${(elapsedMs / 1000).toFixed(1)}s`,
		},
	};
};
