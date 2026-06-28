import { describe, expect, it } from "vitest";
import {
	createAislopCiWorkflow,
	createAislopPackageScripts,
	maybeRunAislop,
	resolveAislopRunRequest,
	type AislopRunRequest,
} from "../src/framework-adapters/core.js";
import aislopAstro, { createAstroAislopScripts } from "../src/framework-adapters/astro.js";
import withAislopExpo from "../src/framework-adapters/expo.js";
import { createAislopNuxtModule } from "../src/framework-adapters/nuxt.js";
import aislopSvelteKit from "../src/framework-adapters/sveltekit.js";
import aislopVite from "../src/framework-adapters/vite.js";

const recordingRunner = (calls: AislopRunRequest[]) => async (request: AislopRunRequest) => {
	calls.push(request);
	return {
		command: request.bin,
		args: request.args,
		exitCode: 0,
		signal: null,
		skipped: false,
	};
};

describe("framework adapters", () => {
	it("resolves aislop command defaults without enabling execution", async () => {
		const request = resolveAislopRunRequest("astro", { args: ["--changes"] });

		expect(request.bin).toBe("aislop");
		expect(request.args).toEqual(["ci", "--changes"]);

		const skipped = await maybeRunAislop("astro", { args: ["--changes"] });
		expect(skipped).toMatchObject({
			command: "aislop",
			args: ["ci", "--changes"],
			exitCode: 0,
			skipped: true,
		});
	});

	it("generates package scripts and a workflow snippet", () => {
		expect(createAislopPackageScripts("expo")).toEqual({
			"aislop:agent": "aislop agent",
			"aislop:ci": "aislop ci",
			"aislop:hook": "aislop hook install",
			"aislop:scan": "aislop scan",
		});
		expect(createAislopCiWorkflow()).toContain("npx --yes aislop@latest ci");
	});

	it("builds an Astro integration with opt-in build execution", async () => {
		const calls: AislopRunRequest[] = [];
		const integration = aislopAstro({ enabled: true, runner: recordingRunner(calls) });

		expect(integration.name).toBe("@scanaislop/astro");
		expect(createAstroAislopScripts()["aislop:ci"]).toBe("aislop ci");

		await integration.hooks["astro:build:start"]?.();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.framework).toBe("astro");
	});

	it("merges Expo config metadata without removing existing extra values", () => {
		const config = withAislopExpo({ name: "mobile", extra: { apiUrl: "https://example.test" } });

		expect(config.extra?.apiUrl).toBe("https://example.test");
		expect(config.extra?.aislop).toEqual({
			command: "npx --yes aislop@latest ci",
			enabled: true,
			hook: "aislop hook install",
		});
	});

	it("registers a Nuxt build hook and runs through the injected runner", async () => {
		const calls: AislopRunRequest[] = [];
		let callback: (() => Promise<void>) | null = null;
		const module = createAislopNuxtModule({ enabled: true, runner: recordingRunner(calls) });

		module.setup(
			{},
			{
				hook(name, cb) {
					expect(name).toBe("build:before");
					callback = cb;
				},
			},
		);

		await callback?.();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.framework).toBe("nuxt");
	});

	it("runs Vite and SvelteKit plugins through build hooks only when enabled", async () => {
		const calls: AislopRunRequest[] = [];
		const vite = aislopVite({ enabled: true, runner: recordingRunner(calls), hook: "buildStart" });
		const svelte = aislopSvelteKit({ enabled: true, runner: recordingRunner(calls) });

		expect(vite.name).toBe("aislop:vite");
		expect(vite.apply).toBe("build");

		await vite.buildStart?.();
		await svelte.closeBundle?.();

		expect(calls.map((call) => call.framework)).toEqual(["vite", "sveltekit"]);
	});
});
