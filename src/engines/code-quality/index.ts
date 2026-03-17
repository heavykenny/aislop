import type { Diagnostic, Engine, EngineContext, EngineResult } from "../types.js";
import { checkComplexity } from "./complexity.js";
import { checkDuplication } from "./duplication.js";
import { runKnip } from "./knip.js";

export const codeQualityEngine: Engine = {
	name: "code-quality",

	async run(context: EngineContext): Promise<EngineResult> {
		const diagnostics: Diagnostic[] = [];

		const promises: Promise<Diagnostic[]>[] = [];

		// Knip for JS/TS dead code
		if (context.languages.includes("typescript") || context.languages.includes("javascript")) {
			promises.push(runKnip(context.rootDirectory));
		}

		// Complexity checks for all files
		promises.push(checkComplexity(context));

		// Duplication checks
		promises.push(checkDuplication(context));

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
