import path from "node:path";
import { installRulesOnly, uninstallRulesOnly } from "./rules-only.js";
import type { HookInstallOpts, HookInstallResult, HookUninstallResult } from "./types.js";

export const resolveCodexPaths = (opts: HookInstallOpts) => ({
	rules:
		opts.scope === "project"
			? path.join(opts.cwd, "AGENTS.md")
			: path.join(opts.home, ".codex", "AGENTS.md"),
});

export const installCodex = (opts: HookInstallOpts): HookInstallResult =>
	installRulesOnly(opts, resolveCodexPaths(opts), "write AGENTS.md rules for Codex");

export const uninstallCodex = (opts: Omit<HookInstallOpts, "qualityGate">): HookUninstallResult =>
	uninstallRulesOnly(opts, resolveCodexPaths(opts));
