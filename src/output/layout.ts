import type { Framework, Language } from "../utils/discover.js";
import { highlighter } from "../utils/highlighter.js";
import { logger } from "../utils/logger.js";

interface ProjectSummaryInfo {
	projectName: string;
	languages: Language[];
}

interface ProjectMetadataInfo {
	sourceFileCount: number;
	frameworks: Framework[];
}

export const formatElapsed = (elapsedMs: number): string =>
	elapsedMs < 1000
		? `${Math.round(elapsedMs)}ms`
		: `${(elapsedMs / 1000).toFixed(1)}s`;

export const printCommandHeader = (commandName: string): void => {
	logger.log(highlighter.bold(`Slope ${commandName}`));
	logger.log(highlighter.dim(`v${process.env.VERSION ?? "0.1.0"}`));
	logger.break();
};

export const formatProjectSummary = (project: ProjectSummaryInfo): string =>
	`Project ${highlighter.info(project.projectName)} (${highlighter.info(project.languages.join(", "))})`;

export const printProjectMetadata = (project: ProjectMetadataInfo): void => {
	logger.log(
		`  Source files: ${highlighter.info(String(project.sourceFileCount))}`,
	);
	const frameworks = project.frameworks.filter(
		(framework) => framework !== "none",
	);
	if (frameworks.length > 0) {
		logger.log(`  Frameworks: ${highlighter.info(frameworks.join(", "))}`);
	}
	logger.break();
};
