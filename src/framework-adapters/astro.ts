import {
	type AislopAdapterOptions,
	type AislopRunResult,
	createAislopCiWorkflow,
	createAislopPackageScripts,
	maybeRunAislop,
} from "./core.js";

export interface AstroIntegration {
	name: string;
	hooks: {
		"astro:build:start"?: () => Promise<void>;
	};
}

export interface AislopAstroOptions extends AislopAdapterOptions {
	runOnBuild?: boolean;
}

export const createAstroAislopScripts = (): Record<string, string> =>
	createAislopPackageScripts("astro");

export const createAstroAislopWorkflow = (): string => createAislopCiWorkflow();

export const runAstroAislop = async (options: AislopAstroOptions = {}): Promise<AislopRunResult> =>
	maybeRunAislop("astro", {
		...options,
		enabled: options.enabled ?? options.runOnBuild ?? false,
	});

const aislopAstro = (options: AislopAstroOptions = {}): AstroIntegration => ({
	name: "@scanaislop/astro",
	hooks: {
		"astro:build:start": async () => {
			await runAstroAislop(options);
		},
	},
});

export default aislopAstro;
