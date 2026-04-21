import type { Diagnostic, Engine, EngineContext, EngineResult } from "../types.js";
import { checkComplexity } from "./complexity.js";
import { detectDuplicateBlocks } from "./duplicate-block.js";
import { runKnip } from "./knip.js";
import { detectRepeatedChainedCalls } from "./repeated-chained-call.js";

export const codeQualityEngine: Engine = {
	name: "code-quality",

	async run(context: EngineContext): Promise<EngineResult> {
		const diagnostics: Diagnostic[] = [];

		const promises: Promise<Diagnostic[]>[] = [];

		if (context.languages.includes("typescript") || context.languages.includes("javascript")) {
			promises.push(runKnip(context.rootDirectory));
		}

		promises.push(checkComplexity(context));
		promises.push(detectRepeatedChainedCalls(context));
		promises.push(detectDuplicateBlocks(context));

		const results = await Promise.allSettled(promises);
		for (const result of results) {
			if (result.status === "fulfilled") {
				diagnostics.push(...result.value);
			}
		}

		return {
			engine: "code-quality",
			diagnostics,
			elapsed: 0,
			skipped: false,
		};
	},
};
