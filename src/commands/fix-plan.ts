import type { AislopConfig } from "../config/index.js";
import type { ProjectInfo } from "../utils/discover.js";

interface FixStepPlanOptions {
	force?: boolean;
}

const hasJsTs = (projectInfo: ProjectInfo): boolean =>
	projectInfo.languages.includes("typescript") || projectInfo.languages.includes("javascript");

export const buildFixStepNames = (
	projectInfo: ProjectInfo,
	config: AislopConfig,
	options: FixStepPlanOptions,
): string[] => {
	const stepNames: string[] = [];

	if (config.engines["ai-slop"]) {
		stepNames.push("Unused imports", "Dead code & comments");
	}

	if (config.engines.lint) {
		if (hasJsTs(projectInfo)) {
			stepNames.push("JS/TS lint fixes");
		}
		if (projectInfo.languages.includes("python") && projectInfo.installedTools.ruff) {
			stepNames.push("Python lint fixes");
		}
	}

	if (config.engines["code-quality"] && hasJsTs(projectInfo)) {
		stepNames.push("Unused dependencies");
	}

	if (config.engines.format) {
		if (hasJsTs(projectInfo)) {
			stepNames.push("JS/TS formatting");
		}
		if (projectInfo.languages.includes("python") && projectInfo.installedTools.ruff) {
			stepNames.push("Python formatting");
		}
		if (projectInfo.languages.includes("go") && projectInfo.installedTools.gofmt) {
			stepNames.push("Go formatting");
		}
	}

	if (options.force) {
		if (config.engines["code-quality"] && hasJsTs(projectInfo)) {
			stepNames.push("Remove unused files");
		}
		if (config.engines.security) {
			stepNames.push("Dependency audit fixes");
		}
		if (projectInfo.frameworks.includes("expo")) {
			stepNames.push("Expo dependency alignment");
		}
	}

	return stepNames;
};
