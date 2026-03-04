export { doctorCommand } from "./commands/doctor.js";
export { fixCommand } from "./commands/fix.js";
export { initCommand } from "./commands/init.js";
export { scanCommand } from "./commands/scan.js";
export { loadConfig } from "./config/index.js";
export type { SlopConfig } from "./config/schema.js";
export type {
	Diagnostic,
	EngineName,
	EngineResult,
	Severity,
} from "./engines/types.js";
export type { ScoreResult } from "./scoring/index.js";
export { calculateScore } from "./scoring/index.js";
export type { Framework, Language, ProjectInfo } from "./utils/discover.js";
export { discoverProject } from "./utils/discover.js";
