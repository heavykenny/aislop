import type { Framework, Language } from "../utils/discover.js";

export type Severity = "error" | "warning" | "info";

export type EngineName =
	| "format"
	| "lint"
	| "code-quality"
	| "ai-slop"
	| "architecture"
	| "security";

export type ChangeContext = "changed-line" | "existing-file-context" | "unknown";

export interface Diagnostic {
	filePath: string;
	engine: EngineName;
	rule: string;
	severity: Severity;
	message: string;
	help: string;
	line: number;
	column: number;
	category: string;
	fixable: boolean;
	detail?: string;
	changeContext?: ChangeContext;
}

export interface EngineResult {
	engine: EngineName;
	diagnostics: Diagnostic[];
	elapsed: number;
	skipped: boolean;
	skipReason?: string;
}

export interface EngineContext {
	rootDirectory: string;
	languages: Language[];
	frameworks: Framework[];
	readonly dependencyAuditFiles?: string[];
	readonly dependencyAuditLanguages?: Language[];
	readonly dependencyAuditScope?: "full" | "files";
	files?: string[];
	testFiles?: string[];
	projectFiles?: string[];
	// Raw user exclude entries (config `exclude` + `.aislopignore`). The
	// file-scanning engines already start from the excluded file list; this lets
	// the build-backed C# engines - which shell out to tools that scan whole
	// projects - honor the same excludes via a shared diagnostic post-filter.
	excludePatterns?: string[];
	installedTools: Record<string, boolean>;
	config: EngineConfig;
}

export interface EngineConfig {
	quality: {
		maxFunctionLoc: number;
		maxFileLoc: number;
		maxNesting: number;
		maxParams: number;
	};
	security: {
		audit: boolean;
		auditTimeout: number;
	};
	lint: {
		typecheck: boolean;
		expoDoctor: boolean;
		csharp?: {
			projectEvaluation?: boolean;
			jb: boolean;
			roslynator: boolean;
			jbSeverityFloor: "ERROR" | "WARNING" | "SUGGESTION" | "HINT";
			jbExcludeTypes: string[];
			jbProjects?: string;
		};
		cpp?: {
			cppcheck: boolean;
			clangTidy: boolean;
			cppcheckEnable: string;
			jb: boolean;
			jbProjects?: string;
			jbSeverityFloor: "ERROR" | "WARNING" | "SUGGESTION" | "HINT";
			jbExcludeTypes: string[];
		};
	};
	allowProjectLocalTools?: boolean;
	architectureRulesPath?: string;
}

export interface Engine {
	name: EngineName;
	run(context: EngineContext): Promise<EngineResult>;
}
