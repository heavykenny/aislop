import type { Framework } from "../../utils/discover.js";

export type TestFramework = "jest" | "vitest" | "mocha" | null;

export const createOxlintConfig = (options: {
	framework?: Framework;
	hasReactCompiler?: boolean;
	testFramework?: TestFramework;
}): Record<string, unknown> => {
	const plugins = ["import", "unicorn", "typescript"];
	const rules: Record<string, string> = {
		// Core correctness
		"no-unused-vars": "warn",
		"no-undef": "error",
		"no-constant-condition": "warn",
		"no-debugger": "warn",
		"no-empty": "warn",
		"no-extra-boolean-cast": "warn",
		"no-irregular-whitespace": "warn",
		"no-loss-of-precision": "error",

		// Import
		"import/no-duplicates": "warn",

		// Unicorn
		"unicorn/no-unnecessary-await": "warn",
	};

	// Add React rules if applicable
	const hasReact =
		options.framework === "react" ||
		options.framework === "nextjs" ||
		options.framework === "vite" ||
		options.framework === "remix";

	if (hasReact) {
		plugins.push("react", "react-hooks", "jsx-a11y");
		Object.assign(rules, {
			"react/no-direct-mutation-state": "error",
			"react-hooks/rules-of-hooks": "error",
			"react-hooks/exhaustive-deps": "warn",
		});
	}

	// Add Next.js specific rules
	if (options.framework === "nextjs") {
		plugins.push("nextjs");
	}

	const env: Record<string, boolean> = {
		browser: true,
		node: true,
		es2022: true,
	};

	const globals: Record<string, string> = {};

	// Add test framework globals
	if (options.testFramework === "jest") {
		globals.jest = "readonly";
		globals.describe = "readonly";
		globals.it = "readonly";
		globals.expect = "readonly";
		globals.test = "readonly";
		globals.beforeAll = "readonly";
		globals.afterAll = "readonly";
		globals.beforeEach = "readonly";
		globals.afterEach = "readonly";
	} else if (options.testFramework === "vitest") {
		globals.describe = "readonly";
		globals.it = "readonly";
		globals.expect = "readonly";
		globals.test = "readonly";
		globals.beforeAll = "readonly";
		globals.afterAll = "readonly";
		globals.beforeEach = "readonly";
		globals.afterEach = "readonly";
		globals.vi = "readonly";
	} else if (options.testFramework === "mocha") {
		globals.describe = "readonly";
		globals.it = "readonly";
		globals.before = "readonly";
		globals.after = "readonly";
		globals.beforeEach = "readonly";
		globals.afterEach = "readonly";
	}

	// Add React Native __DEV__ global
	if (options.framework === "expo" || options.framework === "react") {
		globals.__DEV__ = "readonly";
	}

	return {
		plugins,
		rules,
		env,
		globals,
		settings: {},
	};
};
