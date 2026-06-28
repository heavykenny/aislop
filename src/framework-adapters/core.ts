import { spawn } from "node:child_process";
import process from "node:process";

export type AislopFramework =
	| "astro"
	| "expo"
	| "nuxt"
	| "sveltekit"
	| "vite"
	| "tanstack-start"
	| "redwoodsdk"
	| "t3";

export type AislopAdapterCommand = "ci" | "scan";

export interface AislopRunRequest {
	framework: AislopFramework;
	bin: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export interface AislopRunResult {
	command: string;
	args: string[];
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	skipped: boolean;
}

export type AislopRunner = (
	request: AislopRunRequest,
) => AislopRunResult | Promise<AislopRunResult>;

export interface AislopAdapterOptions {
	/**
	 * Running during a framework build is opt-in so integrations never surprise
	 * local dev servers or production builds.
	 */
	enabled?: boolean;
	command?: AislopAdapterCommand;
	args?: string[];
	bin?: string;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	failOnError?: boolean;
	runner?: AislopRunner;
}

interface AislopPackageScriptsOptions {
	command?: AislopAdapterCommand;
	includeAgent?: boolean;
	includeHook?: boolean;
}

const DEFAULT_ARGS: Record<AislopAdapterCommand, string[]> = {
	ci: ["ci"],
	scan: ["scan"],
};

export const resolveAislopRunRequest = (
	framework: AislopFramework,
	options: AislopAdapterOptions = {},
): AislopRunRequest => {
	const command = options.command ?? "ci";
	const env = options.env ? { ...process.env, ...options.env } : { ...process.env };
	return {
		framework,
		bin: options.bin ?? "aislop",
		args: [...DEFAULT_ARGS[command], ...(options.args ?? [])],
		cwd: options.cwd ?? process.cwd(),
		env,
	};
};

const runAislop = async (request: AislopRunRequest): Promise<AislopRunResult> =>
	new Promise((resolve) => {
		const child = spawn(request.bin, request.args, {
			cwd: request.cwd,
			env: request.env,
			stdio: "inherit",
		});

		child.on("close", (exitCode, signal) => {
			resolve({
				command: request.bin,
				args: request.args,
				exitCode,
				signal,
				skipped: false,
			});
		});
	});

export const maybeRunAislop = async (
	framework: AislopFramework,
	options: AislopAdapterOptions = {},
): Promise<AislopRunResult> => {
	const request = resolveAislopRunRequest(framework, options);

	if (options.enabled !== true) {
		return {
			command: request.bin,
			args: request.args,
			exitCode: 0,
			signal: null,
			skipped: true,
		};
	}

	const result = await (options.runner ?? runAislop)(request);
	if (options.failOnError !== false && !result.skipped && result.exitCode !== 0) {
		throw new Error(
			`aislop ${request.args.join(" ")} failed for ${framework} with exit code ${String(
				result.exitCode,
			)}`,
		);
	}

	return result;
};

export const createAislopPackageScripts = (
	_framework: AislopFramework,
	options: AislopPackageScriptsOptions = {},
): Record<string, string> => {
	const command = options.command ?? "ci";
	const scripts: Record<string, string> = {
		"aislop:scan": "aislop scan",
		"aislop:ci": `aislop ${command}`,
	};

	if (options.includeAgent ?? true) {
		scripts["aislop:agent"] = "aislop agent";
	}

	if (options.includeHook ?? true) {
		scripts["aislop:hook"] = "aislop hook install";
	}

	return scripts;
};

export const createAislopCiWorkflow = (
	packageManagerCommand = "npx --yes aislop@latest ci",
): string =>
	[
		"name: aislop",
		"",
		"on:",
		"  pull_request:",
		"  push:",
		"    branches: [main]",
		"",
		"jobs:",
		"  quality-gate:",
		"    runs-on: ubuntu-latest",
		"    steps:",
		"      - uses: actions/checkout@v4",
		`      - run: ${packageManagerCommand}`,
		"",
	].join("\n");
