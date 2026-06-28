const DIR_PATTERN =
	/(?:^|\/)(?:scripts|bin|examples?|demos?|docs?|bench|benches|benchmarks?|fixtures?|templates?|__fixtures__|__mocks__|__tests__|prototypes?|experiments?|vendor|_vendor|vendored|third_party|blib2to3|lib2to3|cli|cli-[\w-]+|[\w-]+-cli)\//i;

const BASENAME_PATTERN =
	/(?:^|\/)(?:(?:prototype|experiment)(?:[-_.][^/]*)?|(?:benchmark|bench|demo|example|script|seed|migrate|profile|smoke|stress|load|debug|repro)[-_.][^/]*)\.[mc]?[jt]sx?$|(?:^|\/)[^/]+[-_](?:benchmark|bench|demo|example|prototype|experiment)\.[mc]?[jt]sx?$/i;

export const isNonProductionPath = (relativePath: string): boolean =>
	DIR_PATTERN.test(relativePath) || BASENAME_PATTERN.test(relativePath);

/**
 * Common bundler, build, and config files where short label comments
 * (e.g. "// Vue SFC", "// Build styles") are idiomatic and not AI slop.
 * We still want other ai-slop rules (e.g. hallucinated imports, console-leftover)
 * to run on them, so we only suppress the noisiest one (trivial-comment) here
 * using contextual checks (not a blanket file skip).
 */
const TOOLING_CONFIG_BASENAME =
	/(?:^|\/)[^/]*?(?:webpack|vite|rollup|rspack|esbuild|tsup|unbuild|babel|postcss|tailwind|prettier|eslint|next|nuxt|svelte|astro|craco|jest|vitest|playwright|karma)\.config\.[^/]+$/i;

export const isToolingConfigFile = (relativePath: string): boolean =>
	TOOLING_CONFIG_BASENAME.test(relativePath);
