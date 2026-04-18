import type { Diagnostic, Engine, EngineContext, EngineResult } from "../types.js";
import { detectOverAbstraction } from "./abstractions.js";
import { detectTrivialComments } from "./comments.js";
import { detectDeadPatterns } from "./dead-patterns.js";
import { detectSwallowedExceptions } from "./exceptions.js";
import { detectNarrativeComments } from "./narrative-comments.js";
import { detectUnusedImports } from "./unused-imports.js";

export const aiSlopEngine: Engine = {
	name: "ai-slop",

	async run(context: EngineContext): Promise<EngineResult> {
		const diagnostics: Diagnostic[] = [];

		const results = await Promise.allSettled([
			detectTrivialComments(context),
			detectSwallowedExceptions(context),
			detectOverAbstraction(context),
			detectDeadPatterns(context),
			detectUnusedImports(context),
			detectNarrativeComments(context),
		]);

		for (const result of results) {
			if (result.status === "fulfilled") {
				diagnostics.push(...result.value);
			}
		}

		return {
			engine: "ai-slop",
			diagnostics,
			elapsed: 0,
			skipped: false,
		};
	},
};
