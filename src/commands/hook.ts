import os from "node:os";
import { runClaudeHook } from "../hooks/adapters/claude.js";
import { installClaude } from "../hooks/install/claude.js";

export type SupportedAgent = "claude";

interface HookInstallOptions {
	agent: SupportedAgent;
	global: boolean;
}

export const hookInstall = async (opts: HookInstallOptions): Promise<void> => {
	if (opts.agent !== "claude") {
		process.stderr.write(`hook install: agent "${opts.agent}" not implemented yet\n`);
		process.exitCode = 1;
		return;
	}
	if (!opts.global) {
		process.stderr.write("hook install: only --global supported in this release\n");
		process.exitCode = 1;
		return;
	}
	const result = installClaude({ home: os.homedir() });
	if (result.wrote.length === 0) {
		process.stdout.write("hook install: nothing to do (already up to date)\n");
		return;
	}
	for (const f of result.wrote) process.stdout.write(`wrote  ${f}\n`);
	for (const f of result.skipped) process.stdout.write(`skip   ${f}\n`);
};

export const hookRun = async (agent: SupportedAgent): Promise<void> => {
	if (agent !== "claude") {
		process.stderr.write(`hook: agent "${agent}" not implemented yet\n`);
		process.exit(0);
	}
	const exitCode = await runClaudeHook();
	process.exit(exitCode);
};
