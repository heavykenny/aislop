import path from "node:path";
import { installRulesOnly, uninstallRulesOnly } from "./rules-only.js";
import type { HookInstallOpts, HookInstallResult, HookUninstallResult } from "./types.js";

export const resolveKilocodePaths = (opts: HookInstallOpts) => ({
	rules: path.join(opts.cwd, ".kilocode", "rules", "aislop-rules.md"),
});

export const installKilocode = (opts: HookInstallOpts): HookInstallResult => {
	if (opts.scope !== "project") {
		return {
			wrote: [],
			skipped: [],
			planned: [
				{
					path: ".kilocode/rules/aislop-rules.md",
					summary: "Kilo Code is project-scope only; pass --project",
				},
			],
		};
	}
	return installRulesOnly(
		opts,
		resolveKilocodePaths(opts),
		"write .kilocode/rules/aislop-rules.md",
	);
};

export const uninstallKilocode = (
	opts: Omit<HookInstallOpts, "qualityGate">,
): HookUninstallResult => {
	if (opts.scope !== "project") return { removed: [], skipped: [] };
	return uninstallRulesOnly(opts, resolveKilocodePaths(opts));
};
