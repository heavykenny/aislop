import {
	type AislopRunResult,
	createAislopCiWorkflow,
	createAislopPackageScripts,
} from "./core.js";
import aislopVite, { type AislopViteOptions, type VitePluginLike, runViteAislop } from "./vite.js";

export type AislopSvelteKitOptions = Omit<AislopViteOptions, "framework">;

export const createSvelteKitAislopScripts = (): Record<string, string> =>
	createAislopPackageScripts("sveltekit");

export const createSvelteKitAislopWorkflow = (): string => createAislopCiWorkflow();

export const runSvelteKitAislop = async (
	options: AislopSvelteKitOptions = {},
): Promise<AislopRunResult> => runViteAislop({ ...options, framework: "sveltekit" });

const aislopSvelteKit = (options: AislopSvelteKitOptions = {}): VitePluginLike =>
	aislopVite({ ...options, framework: "sveltekit" });

export default aislopSvelteKit;
