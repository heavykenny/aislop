import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
		timeout: 30000,
	},
});
