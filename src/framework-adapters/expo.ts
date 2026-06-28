import {
	type AislopAdapterOptions,
	type AislopRunResult,
	createAislopCiWorkflow,
	createAislopPackageScripts,
	maybeRunAislop,
} from "./core.js";

export interface ExpoConfigLike {
	extra?: Record<string, unknown>;
	[name: string]: unknown;
}

export interface AislopExpoOptions extends AislopAdapterOptions {
	/**
	 * Expo config plugins run while resolving app config. Keep scan execution out
	 * of that path unless a host integration explicitly opts in.
	 */
	runDuringConfig?: boolean;
}

export const createExpoAislopScripts = (): Record<string, string> =>
	createAislopPackageScripts("expo");

export const createExpoAislopWorkflow = (): string => createAislopCiWorkflow();

export const runExpoAislop = async (options: AislopExpoOptions = {}): Promise<AislopRunResult> =>
	maybeRunAislop("expo", {
		...options,
		enabled: options.enabled ?? options.runDuringConfig ?? false,
	});

const withAislopExpo = <TConfig extends ExpoConfigLike>(
	config: TConfig,
	_options: AislopExpoOptions = {},
): TConfig => {
	const extra = {
		...config.extra,
		aislop: {
			command: "npx --yes aislop@latest ci",
			hook: "aislop hook install",
			enabled: true,
		},
	};

	return { ...config, extra };
};

export default withAislopExpo;
