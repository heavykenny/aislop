import {
	type AislopAdapterOptions,
	type AislopRunResult,
	createAislopCiWorkflow,
	createAislopPackageScripts,
	maybeRunAislop,
} from "./core.js";

type NuxtHookName = "build:before" | "nitro:build:before";

export interface NuxtLike {
	hook?: (name: NuxtHookName, callback: () => Promise<void>) => void;
	options?: {
		runtimeConfig?: Record<string, unknown>;
	};
}

export interface AislopNuxtOptions extends AislopAdapterOptions {
	runOnBuild?: boolean;
	hook?: NuxtHookName;
}

export interface NuxtModuleLike {
	meta: {
		name: string;
		configKey: string;
	};
	defaults: AislopNuxtOptions;
	setup: (options: AislopNuxtOptions, nuxt: NuxtLike) => void | Promise<void>;
}

const DEFAULTS: AislopNuxtOptions = {
	command: "ci",
	enabled: false,
	failOnError: true,
	hook: "build:before",
};

export const createNuxtAislopScripts = (): Record<string, string> =>
	createAislopPackageScripts("nuxt");

export const createNuxtAislopWorkflow = (): string => createAislopCiWorkflow();

export const runNuxtAislop = async (options: AislopNuxtOptions = {}): Promise<AislopRunResult> =>
	maybeRunAislop("nuxt", {
		...options,
		enabled: options.enabled ?? options.runOnBuild ?? false,
	});

export const createAislopNuxtModule = (defaults: AislopNuxtOptions = {}): NuxtModuleLike => ({
	meta: {
		name: "@scanaislop/nuxt",
		configKey: "aislop",
	},
	defaults: { ...DEFAULTS, ...defaults },
	setup(options, nuxt) {
		const merged = { ...DEFAULTS, ...defaults, ...options };
		nuxt.hook?.(merged.hook ?? "build:before", async () => {
			await runNuxtAislop(merged);
		});
	},
});

export default createAislopNuxtModule();
