type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "npx" | "unknown";

export const detectPackageManager = (env: NodeJS.ProcessEnv = process.env): PackageManager => {
	const execPath = env.npm_execpath ?? "";
	if (execPath.includes("npx")) return "npx";

	const userAgent = env.npm_config_user_agent ?? "";
	if (userAgent.startsWith("pnpm/")) return "pnpm";
	if (userAgent.startsWith("yarn/")) return "yarn";
	if (userAgent.startsWith("bun/")) return "bun";
	if (userAgent.startsWith("npm/")) return "npm";

	if (execPath.includes("pnpm")) return "pnpm";
	if (execPath.includes("yarn")) return "yarn";
	if (execPath.includes("bun")) return "bun";
	if (execPath.includes("npm")) return "npm";

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
