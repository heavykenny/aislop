import type { Diagnostic, Engine, EngineContext, EngineResult } from "../types.js";
import { runDependencyAudit } from "./audit.js";
import { detectRiskyConstructs } from "./risky.js";
import { scanSecrets } from "./secrets.js";

export const securityEngine: Engine = {
	name: "security",

	async run(context: EngineContext): Promise<EngineResult> {
		const diagnostics: Diagnostic[] = [];

		const promises: Promise<Diagnostic[]>[] = [
			scanSecrets(context),
			detectRiskyConstructs(context),
		];

		if (context.config.security.audit) {
			promises.push(runDependencyAudit(context));
		}

		const results = await Promise.allSettled(promises);
		for (const result of results) {
			if (result.status === "fulfilled") {
				diagnostics.push(...result.value);
			}
		}

		return {
			engine: "security",
			diagnostics,
			elapsed: 0,
			skipped: false,
		};
	},
};
