import type { Framework, Language } from "../utils/discover.js";

export type Severity = "error" | "warning" | "info";

export type EngineName =
	| "format"
	| "lint"
	| "code-quality"
	| "ai-slop"
	| "architecture"
	| "security";

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
	files?: string[];
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
	architectureRulesPath?: string;
}

export interface Engine {
	name: EngineName;
	run(context: EngineContext): Promise<EngineResult>;
}
