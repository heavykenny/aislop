const DIR_PATTERN =
	/(?:^|\/)(?:scripts|bin|examples?|demos?|docs?|bench|benches|benchmarks?|fixtures?|__fixtures__|__mocks__|__tests__|vendor|_vendor|vendored|third_party|blib2to3|lib2to3|cli|cli-[\w-]+|[\w-]+-cli)\//i;

const BASENAME_PATTERN =
	/(?:^|\/)(?:benchmark|bench|demo|example|script|seed|migrate|profile|smoke|stress|load|debug|repro)[-_.][^/]*\.[mc]?[jt]sx?$|(?:^|\/)[^/]+[-_](?:benchmark|bench|demo|example)\.[mc]?[jt]sx?$/i;

export const isNonProductionPath = (relativePath: string): boolean =>
	DIR_PATTERN.test(relativePath) || BASENAME_PATTERN.test(relativePath);
