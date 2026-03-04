import type {
	Diagnostic,
	Engine,
	EngineContext,
	EngineResult,
} from "../types.js";
import { runGenericLinter } from "./generic.js";
import { runGolangciLint } from "./golangci.js";
import { runOxlint } from "./oxlint.js";
import { runRuffLint } from "./ruff.js";

export const lintEngine: Engine = {
	name: "lint",

	async run(context: EngineContext): Promise<EngineResult> {
		const diagnostics: Diagnostic[] = [];
		const { languages, installedTools } = context;

		const promises: Promise<Diagnostic[]>[] = [];

		if (languages.includes("typescript") || languages.includes("javascript")) {
			promises.push(runOxlint(context));
		}

		if (languages.includes("python") && installedTools["ruff"]) {
			promises.push(runRuffLint(context));
		}

		if (languages.includes("go") && installedTools["golangci-lint"]) {
			promises.push(runGolangciLint(context));
		}

		if (languages.includes("rust") && installedTools["cargo"]) {
			promises.push(runGenericLinter(context, "rust"));
		}

		if (languages.includes("ruby") && installedTools["rubocop"]) {
			promises.push(runGenericLinter(context, "ruby"));
		}

		const results = await Promise.allSettled(promises);
		for (const result of results) {
			if (result.status === "fulfilled") {
				diagnostics.push(...result.value);
			}
		}

		return {
			engine: "lint",
			diagnostics,
			elapsed: 0,
			skipped: false,
		};
	},
};
