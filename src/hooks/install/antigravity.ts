import path from "node:path";
import { installRulesOnly, uninstallRulesOnly } from "./rules-only.js";
import type { HookInstallOpts, HookInstallResult, HookUninstallResult } from "./types.js";

export const resolveAntigravityPaths = (opts: HookInstallOpts) => ({
	rules: path.join(opts.cwd, ".agents", "rules", "antigravity-aislop-rules.md"),
});

export const installAntigravity = (opts: HookInstallOpts): HookInstallResult => {
	if (opts.scope !== "project") {
		return {
			wrote: [],
			skipped: [],
			planned: [
				{
					path: ".agents/rules/antigravity-aislop-rules.md",
					summary: "Antigravity is project-scope only; pass --project",
				},
			],
		};
	}
	return installRulesOnly(
		opts,
		resolveAntigravityPaths(opts),
		"write .agents/rules/antigravity-aislop-rules.md",
	);
};

export const uninstallAntigravity = (
	opts: Omit<HookInstallOpts, "qualityGate">,
): HookUninstallResult => {
	if (opts.scope !== "project") return { removed: [], skipped: [] };
	return uninstallRulesOnly(opts, resolveAntigravityPaths(opts));
};
