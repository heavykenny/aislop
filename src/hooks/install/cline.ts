import path from "node:path";
import { installRulesOnly, uninstallRulesOnly } from "./rules-only.js";
import type { HookInstallOpts, HookInstallResult, HookUninstallResult } from "./types.js";

export const resolveClinePaths = (opts: HookInstallOpts) => ({
	rules: path.join(opts.cwd, ".clinerules"),
});

export const resolveRooPaths = (opts: HookInstallOpts) => ({
	rules: path.join(opts.cwd, ".roo", "rules", "aislop.md"),
});

export const installCline = (opts: HookInstallOpts): HookInstallResult => {
	if (opts.scope !== "project") {
		return {
			wrote: [],
			skipped: [],
			planned: [{ path: ".clinerules", summary: "Cline is project-scope only; pass --project" }],
		};
	}
	const cline = installRulesOnly(opts, resolveClinePaths(opts), "write .clinerules");
	const roo = installRulesOnly(opts, resolveRooPaths(opts), "write .roo/rules/aislop.md");
	return {
		wrote: [...cline.wrote, ...roo.wrote],
		skipped: [...cline.skipped, ...roo.skipped],
		planned: [...cline.planned, ...roo.planned],
	};
};

export const uninstallCline = (opts: Omit<HookInstallOpts, "qualityGate">): HookUninstallResult => {
	if (opts.scope !== "project") return { removed: [], skipped: [] };
	const a = uninstallRulesOnly(opts, resolveClinePaths(opts));
	const b = uninstallRulesOnly(opts, resolveRooPaths(opts));
	return {
		removed: [...a.removed, ...b.removed],
		skipped: [...a.skipped, ...b.skipped],
	};
};
