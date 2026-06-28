import fs from "node:fs";
import { defineConfig } from "tsdown";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
	version: string;
};

export default defineConfig([
	{
		entry: {
			cli: "./src/cli.ts",
		},
		external: ["oxlint", "knip", "knip/session", "@biomejs/biome", "typescript"],
		dts: true,
		target: "node18",
		platform: "node",
		env: {
			VERSION: process.env.VERSION ?? packageJson.version,
		},
		fixedExtension: false,
		banner: "#!/usr/bin/env node",
	},
	{
		entry: {
			index: "./src/index.ts",
			"adapters/astro": "./src/framework-adapters/astro.ts",
			"adapters/expo": "./src/framework-adapters/expo.ts",
			"adapters/nuxt": "./src/framework-adapters/nuxt.ts",
			"adapters/sveltekit": "./src/framework-adapters/sveltekit.ts",
			"adapters/vite": "./src/framework-adapters/vite.ts",
		},
		external: ["oxlint", "knip", "knip/session", "@biomejs/biome", "typescript"],
		dts: true,
		target: "node18",
		platform: "node",
		env: {
			VERSION: process.env.VERSION ?? packageJson.version,
		},
		fixedExtension: false,
	},
	{
		entry: {
			mcp: "./src/mcp.ts",
		},
		external: ["oxlint", "knip", "knip/session", "@biomejs/biome", "typescript"],
		dts: false,
		target: "node18",
		platform: "node",
		env: {
			VERSION: process.env.VERSION ?? packageJson.version,
		},
		fixedExtension: false,
		banner: "#!/usr/bin/env node",
	},
]);
