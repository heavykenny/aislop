import path from "node:path";
import { installRulesOnly, uninstallRulesOnly } from "./rules-only.js";
import type { HookInstallOpts, HookInstallResult, HookUninstallResult } from "./types.js";

export const resolveCopilotPaths = (opts: HookInstallOpts) => ({
	rules: path.join(opts.cwd, ".github", "copilot-instructions.md"),
});

export const installCopilot = (opts: HookInstallOpts): HookInstallResult => {
	if (opts.scope !== "project") {
		return {
			wrote: [],
			skipped: [],
			planned: [
				{
					path: ".github/copilot-instructions.md",
					summary: "Copilot is project-scope only; pass --project",
				},
			],
		};
	}
	return installRulesOnly(opts, resolveCopilotPaths(opts), "write .github/copilot-instructions.md");
};

export const uninstallCopilot = (
	opts: Omit<HookInstallOpts, "qualityGate">,
): HookUninstallResult => {
	if (opts.scope !== "project") return { removed: [], skipped: [] };
	return uninstallRulesOnly(opts, resolveCopilotPaths(opts));
};
