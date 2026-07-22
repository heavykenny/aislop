import { runEngines } from "../engines/orchestrator.js";
import type { EngineContext, EngineName, EngineResult } from "../engines/types.js";
import { ENGINE_INFO, getEngineLabel } from "../output/engine-info.js";
import { printEngineStatus } from "../output/terminal.js";
import { type GridRow, type GridRowOutcome, LiveGrid } from "../ui/live-grid.js";

const ALL_ENGINE_NAMES = Object.keys(ENGINE_INFO) as EngineName[];

const resultSummary = (result: EngineResult): { outcome: GridRowOutcome; summary: string } => {
	const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
	if (errors > 0) {
		return { outcome: "fail", summary: `${errors} error${errors === 1 ? "" : "s"}` };
	}
	const warnings = result.diagnostics.filter(
		(diagnostic) => diagnostic.severity === "warning",
	).length;
	if (warnings > 0) {
		return { outcome: "warn", summary: `${warnings} warning${warnings === 1 ? "" : "s"}` };
	}
	return { outcome: "ok", summary: "0 issues" };
};

export const runEnginesWithProgress = async (
	context: EngineContext,
	enabled: Record<string, boolean>,
	machineOutput: boolean,
): Promise<EngineResult[]> => {
	const useLiveProgress =
		!machineOutput &&
		Boolean(process.stderr.isTTY) &&
		process.env.CI !== "true" &&
		process.env.CI !== "1";
	const rows: GridRow[] = ALL_ENGINE_NAMES.filter((engine) => enabled[engine] !== false).map(
		(engine) => ({ key: engine, label: getEngineLabel(engine), status: "queued" }),
	);
	const renderer = useLiveProgress ? new LiveGrid(rows) : null;
	renderer?.start();
	const results = await runEngines(
		context,
		enabled,
		(engine) => renderer?.update(engine, { status: "running" }),
		(result) => {
			if (result.skipped) {
				renderer?.update(result.engine, { status: "skipped", summary: "skipped" });
			} else {
				renderer?.update(result.engine, {
					status: "done",
					...resultSummary(result),
					elapsedMs: result.elapsed,
				});
			}
			if (!machineOutput && !renderer) printEngineStatus(result);
		},
	);
	renderer?.stop();
	return results;
};
