import type { ProjectInfo } from "./fix-pipeline.js";

export const hasJsOrTs = (projectInfo: ProjectInfo): boolean =>
	projectInfo.languages.includes("typescript") || projectInfo.languages.includes("javascript");
