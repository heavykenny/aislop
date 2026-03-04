import type {
	Diagnostic,
	Engine,
	EngineContext,
	EngineResult,
} from "../types.js";
import { detectOverAbstraction } from "./abstractions.js";
import { detectTrivialComments } from "./comments.js";
import { detectSwallowedExceptions } from "./exceptions.js";

export const aiSlopEngine: Engine = {
	name: "ai-slop",

	async run(context: EngineContext): Promise<EngineResult> {
		const diagnostics: Diagnostic[] = [];

		const results = await Promise.allSettled([
			detectTrivialComments(context),
			detectSwallowedExceptions(context),
			detectOverAbstraction(context),
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
