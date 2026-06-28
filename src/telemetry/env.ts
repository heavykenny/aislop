type InstallChannel =
	| "npm"
	| "pnpm"
	| "yarn"
	| "bun"
	| "npx"
	| "homebrew"
	| "pip"
	| "pipx"
	| "direct"
	| "unknown";

const ALLOWED_OVERRIDE = new Set<InstallChannel>([
	"npm",
	"pnpm",
	"yarn",
	"bun",
	"npx",
	"homebrew",
	"pip",
	"pipx",
	"direct",
	"unknown",
]);

const normalizePath = (path: string): string => path.replaceAll("\\", "/").toLowerCase();

const entryScriptPath = (argv: string[]): string => {
	const candidate = argv[1] ?? "";
	if (candidate.length === 0) return "";

	const normalized = normalizePath(candidate);
	if (
		candidate.endsWith(".js") ||
		normalized.includes("node_modules") ||
		normalized.includes("/cellar/") ||
		normalized.includes("/pipx/") ||
		normalized.includes("site-packages")
	) {
		return candidate;
	}

	return "";
};

const pathLooksHomebrew = (path: string): boolean => {
	const normalized = normalizePath(path);
	return (
		normalized.includes("/cellar/aislop/") ||
		(normalized.includes("/homebrew/") && normalized.includes("/aislop/")) ||
		(normalized.includes("/opt/homebrew/") &&
			normalized.includes("/libexec/") &&
			normalized.includes("/aislop/"))
	);
};

const pathLooksPipx = (path: string): boolean => normalizePath(path).includes("/pipx/");

const pathLooksDirect = (path: string, env: NodeJS.ProcessEnv): boolean => {
	const normalized = normalizePath(path);
	if (!normalized.includes("node_modules")) return false;
	if (normalized.includes("/_npx/")) return false;

	const hasNpmWrapper =
		Boolean(env.npm_execpath) ||
		Boolean(env.npm_command) ||
		Boolean(env.npm_lifecycle_event) ||
		Boolean(env.npm_config_user_agent);

	return !hasNpmWrapper;
};

const detectNodePackageManager = (env: NodeJS.ProcessEnv): InstallChannel | null => {
	const execPath = env.npm_execpath ?? "";
	if (
		execPath.includes("npx") ||
		execPath.includes("_npx") ||
		env.npm_command === "npx" ||
		env.npm_lifecycle_event === "npx"
	) {
		return "npx";
	}

	const userAgent = env.npm_config_user_agent ?? "";
	if (userAgent.startsWith("pnpm/")) return "pnpm";
	if (userAgent.startsWith("yarn/")) return "yarn";
	if (userAgent.startsWith("bun/")) return "bun";
	if (userAgent.startsWith("npm/")) return "npm";

	if (execPath.includes("pnpm")) return "pnpm";
	if (execPath.includes("yarn")) return "yarn";
	if (execPath.includes("bun")) return "bun";
	if (execPath.includes("npm")) return "npm";

	return null;
};

export const detectInstallChannel = (
	env: NodeJS.ProcessEnv = process.env,
	argv: string[] = process.argv,
): InstallChannel => {
	const override = env.AISLOP_INSTALL_CHANNEL?.trim().toLowerCase();
	if (override && ALLOWED_OVERRIDE.has(override as InstallChannel)) {
		return override as InstallChannel;
	}

	const scriptPath = entryScriptPath(argv);
	const probePaths = [scriptPath, env.npm_execpath ?? ""].filter((path) => path.length > 0);

	for (const path of probePaths) {
		if (pathLooksHomebrew(path)) return "homebrew";
	}

	for (const path of probePaths) {
		if (pathLooksPipx(path)) return "pipx";
	}

	const nodePackageManager = detectNodePackageManager(env);
	if (nodePackageManager != null) return nodePackageManager;

	if (scriptPath.length > 0 && pathLooksDirect(scriptPath, env)) return "direct";

	return "unknown";
};

const CI_ENV_KEYS = [
	"CI",
	"GITHUB_ACTIONS",
	"GITLAB_CI",
	"CIRCLECI",
	"TRAVIS",
	"BUILDKITE",
	"DRONE",
	"TEAMCITY_VERSION",
	"TF_BUILD",
];

export const isCiEnv = (env: NodeJS.ProcessEnv = process.env): boolean =>
	CI_ENV_KEYS.some((k) => {
		const v = env[k];
		return v === "true" || v === "1" || (v != null && v.length > 0 && k !== "CI");
	}) ||
	env.CI === "true" ||
	env.CI === "1";

export const fileCountBucket = (count: number): string => {
	if (count < 10) return "0-10";
	if (count < 50) return "10-50";
	if (count < 100) return "50-100";
	if (count < 500) return "100-500";
	if (count < 1000) return "500-1000";
	return "1000+";
};

export const scoreBucket = (score: number): string => {
	if (score >= 75) return "75-100";
	if (score >= 50) return "50-75";
	if (score >= 25) return "25-50";
	return "0-25";
};
