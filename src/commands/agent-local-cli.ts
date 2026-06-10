import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log } from "../ui/logger.js";
import type { AgentScanJson } from "./agent-types.js";

const cliPath = (): string => {
	const arg = process.argv[1];
	if (arg && fs.existsSync(arg)) return arg;
	return path.resolve("dist/cli.js");
};

const runSelf = (
	args: string[],
	cwd: string,
): { exitCode: number | null; stdout: string; stderr: string } => {
	const result = spawnSync(process.execPath, [cliPath(), ...args], {
		cwd,
		encoding: "utf-8",
		env: {
			...process.env,
			AISLOP_NO_TELEMETRY: "1",
			AISLOP_NO_UPDATE_NOTIFIER: "1",
			NO_COLOR: "1",
		},
		maxBuffer: 50 * 1024 * 1024,
	});
	return {
		exitCode: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
};

export const scanJson = (cwd: string): AgentScanJson => {
	const result = runSelf(["scan", ".", "--json"], cwd);
	if (!result.stdout.trim()) {
		throw new Error(result.stderr || "aislop scan did not produce JSON output.");
	}
	try {
		return JSON.parse(result.stdout) as AgentScanJson;
	} catch (error) {
		throw new Error(
			`Failed to parse aislop scan output: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

export const runSafeFix = (cwd: string): void => {
	const result = runSelf(["fix", ".", "--safe"], cwd);
	if (result.exitCode !== 0 && result.stderr.trim()) {
		log.warn(result.stderr.trim().split("\n")[0] ?? "Safe fix reported a non-zero exit.");
	}
};

export const applyDiff = async (root: string, patch: string): Promise<void> => {
	const child = spawnSync("git", ["apply", "--index", "--whitespace=nowarn", "-"], {
		cwd: root,
		input: patch,
		encoding: "utf-8",
		maxBuffer: 50 * 1024 * 1024,
	});
	if (child.status !== 0) {
		throw new Error(child.stderr || child.stdout || "Failed to apply agent diff.");
	}
};
