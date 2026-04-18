import type { Framework } from "../../utils/discover.js";

export type TestFramework = "jest" | "vitest" | "mocha" | null;

interface OxlintConfigOptions {
	framework?: Framework;
	hasReactCompiler?: boolean;
	testFramework?: TestFramework;
	/**
	 * When "fix", rules with destructive auto-fixes (that can orphan code,
	 * e.g. deleting an unused arrow-function signature and leaving the body)
	 * are disabled so `oxlint --fix` never damages files. aislop runs its
	 * own non-destructive `applyUnusedVarPrefixFixes` after detection.
	 * Defaults to "detect" (the detector config, with `no-unused-vars: warn`).
	 */
	mode?: "detect" | "fix";
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

	// Import
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
	if (hasReact(options.framework)) Object.assign(rules, buildReactRules());
	// When building a config for the fix pass, disable rules whose auto-fix
	// is destructive (e.g. deletes an arrow-function signature while leaving
	// the body behind, producing an illegal orphan return). aislop's own
	// prefixUnusedVars (AST-based) runs after detection and handles unused
	// vars by prefixing with `_`, which is always safe.
	//
	// `react-hooks/exhaustive-deps`: oxlint's autofix naively appends missing
	// dependencies to the useEffect/useCallback dep array. When the missing
	// dep is a function declared AFTER the hook (hoisted `const fn = …` rather
	// than a `function` declaration), the autofix introduces a TDZ error
	// (TS2448: "Block-scoped variable used before its declaration").
	// We keep detection enabled (`warn` below) but disable autofix.
	if (options.mode === "fix") {
		rules["no-unused-vars"] = "off";
		rules["react-hooks/exhaustive-deps"] = "off";
	}

	const plugins = ["import", "unicorn", "typescript", ...buildFrameworkPlugins(options.framework)];

	const globals = buildTestGlobals(options.testFramework ?? null);
	if (options.framework === "expo" || options.framework === "react") {
		globals.__DEV__ = "readonly";
	}
	// Astro frontmatter exposes `Astro` as a global, and `<script define:vars>`
	// blocks inject arbitrary runtime names that oxlint can't see. `astro check`
	// + tsc handle these at build time, so we turn no-undef off for Astro projects.
	// Inline scripts in Astro layouts commonly contain third-party init snippets
	// (PostHog, Plausible, GTM) with `!function(){}()` IIFE patterns that
	// no-unused-expressions flags as useless — disable it for the same reason.
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
