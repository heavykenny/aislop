import type { Framework } from "../../utils/discover.js";

export const createOxlintConfig = (options: {
	framework?: Framework;
	hasReactCompiler?: boolean;
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
		plugins.push("react", "react-hooks", "react-perf", "jsx-a11y");
		Object.assign(rules, {
			"react/no-direct-mutation-state": "error",
			"react-hooks/rules-of-hooks": "error",
			"react-hooks/exhaustive-deps": "warn",
			"react-perf/jsx-no-new-object-as-prop": "warn",
		});
	}

	// Add Next.js specific rules
	if (options.framework === "nextjs") {
		plugins.push("nextjs");
	}

	return {
		plugins,
		rules,
		env: { browser: true, node: true, es2022: true },
		settings: {},
	};
};
