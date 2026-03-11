import { performance } from "node:perf_hooks";
import { aiSlopEngine } from "./ai-slop/index.js";
import { architectureEngine } from "./architecture/index.js";
import { codeQualityEngine } from "./code-quality/index.js";
import { formatEngine } from "./format/index.js";
import { lintEngine } from "./lint/index.js";
import { securityEngine } from "./security/index.js";
import type {
	Engine,
	EngineContext,
	EngineName,
	EngineResult,
} from "./types.js";

const ALL_ENGINES: Engine[] = [
	formatEngine,
	lintEngine,
	codeQualityEngine,
	aiSlopEngine,
	architectureEngine,
	securityEngine,
];

export const runEngines = async (
	context: EngineContext,
	enabledEngines: Record<string, boolean>,
	onStart?: (name: EngineName) => void,
	onComplete?: (result: EngineResult) => void,
): Promise<EngineResult[]> => {
	const engines = ALL_ENGINES.filter((e) => enabledEngines[e.name] !== false);

	const results = await Promise.allSettled(
		engines.map(async (engine) => {
			onStart?.(engine.name);
			const start = performance.now();

			try {
				const result = await engine.run(context);
				result.elapsed = performance.now() - start;
				onComplete?.(result);
				return result;
			} catch (error) {
				const result: EngineResult = {
					engine: engine.name,
					diagnostics: [],
					elapsed: performance.now() - start,
					skipped: true,
					skipReason: error instanceof Error ? error.message : String(error),
				};
				onComplete?.(result);
				return result;
			}
		}),
	);

	return results.map((r, i) =>
		r.status === "fulfilled"
			? r.value
			: {
					engine: engines[i].name,
					diagnostics: [],
					elapsed: 0,
					skipped: true,
					skipReason:
						r.reason instanceof Error ? r.reason.message : String(r.reason),
				},
	);
};
