import type { AislopConfig } from "../config/index.js";
import type { ProjectInfo } from "../utils/discover.js";

export interface FixPlanStep {
	name: string;
	status: "planned" | "skipped";
	reason?: string;
}

export interface FixPlanOptions {
	force?: boolean;
	safe?: boolean;
}

const SKIPPED_BY_SAFE = "skipped by --safe";
const DISABLED_IN_CONFIG = "disabled in config";

const hasJsTs = (projectInfo: ProjectInfo): boolean =>
	projectInfo.languages.includes("typescript") || projectInfo.languages.includes("javascript");

const planned = (name: string): FixPlanStep => ({ name, status: "planned" });

const skipped = (name: string, reason: string): FixPlanStep => ({
	name,
	status: "skipped",
	reason,
});

const gated = (name: string, enabled: boolean, reason: string): FixPlanStep =>
	enabled ? planned(name) : skipped(name, reason);

const planAiSlop = (config: AislopConfig, safe: boolean): FixPlanStep[] => {
	if (!config.engines["ai-slop"]) {
		const names = safe
			? ["Unused imports", "Duplicate imports", "Narrative comments"]
			: ["Unused imports", "Duplicate imports", "Dead code & comments"];
		return names.map((name) => skipped(name, DISABLED_IN_CONFIG));
	}
	if (safe) {
		return [
			planned("Unused imports"),
			planned("Duplicate imports"),
			planned("Narrative comments"),
			skipped("Dead code & comments", SKIPPED_BY_SAFE),
		];
	}
	return [planned("Unused imports"), planned("Duplicate imports"), planned("Dead code & comments")];
};

const planQualityStep = (
	name: string,
	projectInfo: ProjectInfo,
	config: AislopConfig,
	safe: boolean,
): FixPlanStep[] => {
	if (!hasJsTs(projectInfo)) return [];
	const qualityOn = config.engines["code-quality"];
	const reason = safe ? SKIPPED_BY_SAFE : qualityOn ? "" : DISABLED_IN_CONFIG;
	return [reason ? skipped(name, reason) : planned(name)];
};

const planLint = (projectInfo: ProjectInfo, config: AislopConfig, safe: boolean): FixPlanStep[] => {
	const steps: FixPlanStep[] = [];
	const reason = safe ? SKIPPED_BY_SAFE : config.engines.lint ? "" : DISABLED_IN_CONFIG;
	if (hasJsTs(projectInfo)) {
		steps.push(reason ? skipped("Lint fixes (js/ts)", reason) : planned("Lint fixes (js/ts)"));
	}
	if (projectInfo.languages.includes("python") && projectInfo.installedTools.ruff) {
		steps.push(reason ? skipped("Lint fixes (python)", reason) : planned("Lint fixes (python)"));
	}
	if (projectInfo.languages.includes("ruby") && projectInfo.installedTools.rubocop) {
		steps.push(reason ? skipped("Lint fixes (ruby)", reason) : planned("Lint fixes (ruby)"));
	}
	return steps;
};

const planFormatters = (
	projectInfo: ProjectInfo,
	config: AislopConfig,
	safe: boolean,
): FixPlanStep[] => {
	const steps: FixPlanStep[] = [];
	const formatOn = config.engines.format;
	const engineReason = formatOn ? "" : DISABLED_IN_CONFIG;
	const add = (name: string, eligible: boolean, extraReason?: string) => {
		if (!eligible) return;
		if (engineReason) {
			steps.push(skipped(name, engineReason));
			return;
		}
		if (extraReason) {
			steps.push(skipped(name, extraReason));
			return;
		}
		steps.push(planned(name));
	};

	add("Formatting (js/ts)", hasJsTs(projectInfo));
	add(
		"Formatting (python)",
		projectInfo.languages.includes("python") && Boolean(projectInfo.installedTools.ruff),
	);
	add(
		"Formatting (go)",
		projectInfo.languages.includes("go") && Boolean(projectInfo.installedTools.gofmt),
	);
	add(
		"Formatting (rust)",
		projectInfo.languages.includes("rust") && Boolean(projectInfo.installedTools.rustfmt),
	);
	add(
		"Formatting (ruby)",
		projectInfo.languages.includes("ruby") && Boolean(projectInfo.installedTools.rubocop),
		safe ? SKIPPED_BY_SAFE : undefined,
	);
	add(
		"Formatting (php)",
		projectInfo.languages.includes("php") && Boolean(projectInfo.installedTools["php-cs-fixer"]),
		safe ? SKIPPED_BY_SAFE : undefined,
	);
	add(
		"Formatting (csharp)",
		projectInfo.languages.includes("csharp") &&
			Boolean(projectInfo.installedTools.dotnet) &&
			config.lint?.csharp?.projectEvaluation === true,
	);
	add(
		"Formatting (cpp)",
		projectInfo.languages.includes("cpp") && Boolean(projectInfo.installedTools["clang-format"]),
	);
	return steps;
};

const planForce = (
	projectInfo: ProjectInfo,
	config: AislopConfig,
	options: { safe: boolean; forceRequested: boolean },
): FixPlanStep[] => {
	if (!options.forceRequested) return [];
	const reason = options.safe ? SKIPPED_BY_SAFE : "";
	const steps: FixPlanStep[] = [];
	if (hasJsTs(projectInfo)) {
		steps.push(
			reason
				? skipped("Remove unused files", reason)
				: gated("Remove unused files", config.engines["code-quality"], DISABLED_IN_CONFIG),
		);
	}
	steps.push(
		reason
			? skipped("Dependency audit fixes", reason)
			: gated("Dependency audit fixes", config.engines.security, DISABLED_IN_CONFIG),
	);
	if (projectInfo.frameworks.includes("expo")) {
		const expoOn = config.lint.expoDoctor;
		steps.push(
			reason
				? skipped("Expo dependency alignment", reason)
				: gated("Expo dependency alignment", expoOn, "Expo Doctor is not enabled"),
		);
	}
	return steps;
};

export const buildFixPlan = (
	projectInfo: ProjectInfo,
	config: AislopConfig,
	options: FixPlanOptions = {},
): FixPlanStep[] => {
	const safe = Boolean(options.safe);
	const forceRequested = Boolean(options.force);
	return [
		...planAiSlop(config, safe),
		...planQualityStep("Unused declarations", projectInfo, config, safe),
		...planLint(projectInfo, config, safe),
		...planQualityStep("Unused dependencies", projectInfo, config, safe),
		...planFormatters(projectInfo, config, safe),
		...planForce(projectInfo, config, { safe, forceRequested }),
	];
};

export const buildFixStepNames = (
	projectInfo: ProjectInfo,
	config: AislopConfig,
	options: FixPlanOptions = {},
): string[] =>
	buildFixPlan(projectInfo, config, options)
		.filter((step) => step.status === "planned")
		.map((step) => step.name);

export const skippedFixSteps = (plan: FixPlanStep[]): FixPlanStep[] =>
	plan.filter((step) => step.status === "skipped");
