import {
	type AislopAdapterOptions,
	type AislopFramework,
	type AislopRunResult,
	createAislopCiWorkflow,
	createAislopPackageScripts,
	maybeRunAislop,
} from "./core.js";

type ViteApply = "serve" | "build";

export interface VitePluginLike {
	name: string;
	apply?: ViteApply;
	buildStart?: () => Promise<void>;
	closeBundle?: () => Promise<void>;
}

export interface AislopViteOptions extends AislopAdapterOptions {
	framework?: Extract<
		AislopFramework,
		"vite" | "tanstack-start" | "redwoodsdk" | "t3" | "sveltekit"
	>;
	runOnBuild?: boolean;
	hook?: "buildStart" | "closeBundle";
}

export const createViteAislopScripts = (
	framework: AislopViteOptions["framework"] = "vite",
): Record<string, string> => {
	const scripts = createAislopPackageScripts(framework);
	scripts["aislop:build-gate"] = "aislop ci --changes";
	return scripts;
};

export const createViteAislopWorkflow = (): string => createAislopCiWorkflow();

export const runViteAislop = async (options: AislopViteOptions = {}): Promise<AislopRunResult> => {
	const framework = options.framework ?? "vite";
	return maybeRunAislop(framework, {
		...options,
		enabled: options.enabled ?? options.runOnBuild ?? false,
	});
};

const aislopVite = (options: AislopViteOptions = {}): VitePluginLike => {
	const hook = options.hook ?? "closeBundle";
	const run = async () => {
		await runViteAislop(options);
	};

	return {
		name: "aislop:vite",
		apply: "build",
		...(hook === "buildStart" ? { buildStart: run } : { closeBundle: run }),
	};
};

export default aislopVite;
