import type { Framework } from "../../utils/discover.js";

export type TestFramework = "jest" | "vitest" | "mocha" | null;

interface OxlintConfigOptions {
	framework?: Framework;
	hasReactCompiler?: boolean;
	testFramework?: TestFramework;
	mode?: "detect" | "fix";
	globals?: string[];
	noUndefSeverity?: "error" | "warn" | "off";
}

const buildBaseRules = (): Record<string, string> => ({
	// Core correctness
	"no-unused-vars": "warn",
	"no-undef": "error",
	"no-constant-condition": "warn",
	"no-control-regex": "off", // ANSI-stripping regexes are a legitimate CLI pattern
	"no-debugger": "warn",
	"no-empty": "warn",
	"no-extra-boolean-cast": "warn",
	"no-irregular-whitespace": "warn",
	"no-loss-of-precision": "error",

	"import/no-duplicates": "warn",

	// Unicorn
	"unicorn/no-unnecessary-await": "warn",
});

const hasReact = (framework: Framework | undefined): boolean =>
	framework === "react" || framework === "nextjs" || framework === "vite" || framework === "remix";

const buildFrameworkPlugins = (framework: Framework | undefined): string[] => {
	const extra: string[] = [];
	if (hasReact(framework)) extra.push("react", "react-hooks", "jsx-a11y");
	if (framework === "nextjs") extra.push("nextjs");
	return extra;
};

const buildReactRules = (): Record<string, string> => ({
	"react/no-direct-mutation-state": "error",
	"react-hooks/rules-of-hooks": "error",
	"react-hooks/exhaustive-deps": "warn",
});

const TEST_GLOBALS_COMMON = [
	"describe",
	"it",
	"expect",
	"test",
	"beforeAll",
	"afterAll",
	"beforeEach",
	"afterEach",
];

const buildTestGlobals = (testFramework: TestFramework): Record<string, string> => {
	const globals: Record<string, string> = {};
	const setAll = (names: string[]): void => {
		for (const name of names) globals[name] = "readonly";
	};

	if (testFramework === "jest") {
		setAll(TEST_GLOBALS_COMMON);
		globals.jest = "readonly";
	} else if (testFramework === "vitest") {
		setAll(TEST_GLOBALS_COMMON);
		globals.vi = "readonly";
	} else if (testFramework === "mocha") {
		setAll(["describe", "it", "before", "after", "beforeEach", "afterEach"]);
	}

	return globals;
};

export const createOxlintConfig = (options: OxlintConfigOptions): Record<string, unknown> => {
	const rules = buildBaseRules();
	rules["no-undef"] = options.noUndefSeverity ?? rules["no-undef"];
	if (hasReact(options.framework)) Object.assign(rules, buildReactRules());
	if (options.mode === "fix") {
		rules["no-unused-vars"] = "off";
		rules["react-hooks/exhaustive-deps"] = "off";
		// Its autofix deletes aria-hidden, which breaks the sr-only submit-on-Enter pattern.
		rules["jsx-a11y/no-aria-hidden-on-focusable"] = "off";
		// `... (x || {})` is often a deliberate undefined guard and breaks under noUncheckedIndexedAccess.
		rules["unicorn/no-useless-fallback-in-spread"] = "off";
	}

	const plugins = ["import", "unicorn", "typescript", ...buildFrameworkPlugins(options.framework)];

	const globals = buildTestGlobals(options.testFramework ?? null);
	for (const name of [
		"__DEV__",
		"__TEST__",
		"__BROWSER__",
		"__NODE__",
		"__GLOBAL__",
		"__SSR__",
		"__ESM_BROWSER__",
		"__ESM_BUNDLER__",
		"__VERSION__",
		"__COMMIT__",
		"__BUILD__",
	]) {
		globals[name] = "readonly";
	}
	for (const globalName of options.globals ?? []) {
		globals[globalName] = "readonly";
	}
	if (options.framework === "astro") {
		globals.Astro = "readonly";
		rules["no-undef"] = "off";
		rules["no-unused-expressions"] = "off";
	}

	return {
		plugins,
		rules,
		env: { browser: true, node: true, es2022: true },
		globals,
		settings: {},
	};
};
