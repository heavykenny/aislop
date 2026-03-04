import type {
	Diagnostic,
	Engine,
	EngineContext,
	EngineResult,
} from "../types.js";
import { runBiomeFormat } from "./biome.js";
import { runGenericFormatter } from "./generic.js";
import { runGofmt } from "./gofmt.js";
import { runRuffFormat } from "./ruff-format.js";

export const formatEngine: Engine = {
	name: "format",

	async run(context: EngineContext): Promise<EngineResult> {
		const diagnostics: Diagnostic[] = [];
		const { languages, installedTools } = context;

		const promises: Promise<Diagnostic[]>[] = [];

		if (languages.includes("typescript") || languages.includes("javascript")) {
			promises.push(runBiomeFormat(context));
		}

		if (languages.includes("python") && installedTools["ruff"]) {
			promises.push(runRuffFormat(context));
		}

		if (languages.includes("go")) {
			promises.push(runGofmt(context));
		}

		if (languages.includes("rust") && installedTools["rustfmt"]) {
			promises.push(runGenericFormatter(context, "rust"));
		}

		if (languages.includes("ruby") && installedTools["rubocop"]) {
			promises.push(runGenericFormatter(context, "ruby"));
		}

		if (languages.includes("php") && installedTools["php-cs-fixer"]) {
			promises.push(runGenericFormatter(context, "php"));
		}

		const results = await Promise.allSettled(promises);
		for (const result of results) {
			if (result.status === "fulfilled") {
				diagnostics.push(...result.value);
			}
		}

		return {
			engine: "format",
			diagnostics,
			elapsed: 0,
			skipped: false,
		};
	},
};
