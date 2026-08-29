import type { AislopConfig } from "../config/index.js";
import type { EngineContext } from "../engines/types.js";
import { readAislopIgnorePatterns } from "../utils/source-files.js";
import type { ProjectInfo } from "./fix-pipeline.js";
import type { ScanFileScope } from "./scan-file-scope.js";

export const createEngineContext = (
	rootDirectory: string,
	projectInfo: ProjectInfo,
	config: AislopConfig,
	options: { safe?: boolean; scope?: ScanFileScope } = {},
): EngineContext => ({
	rootDirectory,
	languages: projectInfo.languages,
	frameworks: projectInfo.frameworks,
	// Fixers rewrite files, so the exclude list has to reach them: without it a
	// whole-project tool such as dotnet format would reformat excluded code.
	excludePatterns: [...config.exclude, ...readAislopIgnorePatterns(rootDirectory)],
	installedTools: options.safe
		? { ...projectInfo.installedTools, rubocop: false, "php-cs-fixer": false }
		: projectInfo.installedTools,
	config: { quality: config.quality, security: config.security, lint: config.lint },
	...(options.scope
		? {
				files: [...new Set([...options.scope.files, ...options.scope.testFiles])],
				testFiles: options.scope.testFiles,
				projectFiles: options.scope.projectFiles,
				dependencyAuditFiles: options.scope.dependencyAuditFiles,
				dependencyAuditScope: options.scope.dependencyAuditScope,
			}
		: {}),
});
