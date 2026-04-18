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
]);
