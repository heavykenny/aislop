import path from "node:path";
import { installRulesOnly, uninstallRulesOnly } from "./rules-only.js";
import type { HookInstallOpts, HookInstallResult, HookUninstallResult } from "./types.js";

export const resolveWindsurfPaths = (opts: HookInstallOpts) => ({
	rules: path.join(opts.cwd, ".windsurfrules"),
});

export const installWindsurf = (opts: HookInstallOpts): HookInstallResult => {
	if (opts.scope !== "project") {
		return {
			wrote: [],
			skipped: [],
			planned: [
				{ path: ".windsurfrules", summary: "Windsurf is project-scope only; pass --project" },
			],
		};
	}
	return installRulesOnly(opts, resolveWindsurfPaths(opts), "write .windsurfrules");
};

export const uninstallWindsurf = (
	opts: Omit<HookInstallOpts, "qualityGate">,
): HookUninstallResult => {
	if (opts.scope !== "project") return { removed: [], skipped: [] };
	return uninstallRulesOnly(opts, resolveWindsurfPaths(opts));
};
