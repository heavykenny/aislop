import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { type AislopConfig, CONFIG_DIR, RULES_FILE } from "../config/index.js";
import { loadArchitectureRules } from "../engines/architecture/rule-loader.js";
import type { EngineName } from "../engines/types.js";
import { getEngineLabel } from "../output/engine-info.js";
import type { Language, ProjectInfo } from "../utils/discover.js";
import { planSecurity } from "./doctor-security-plan.js";
import { planFormat, planLint } from "./doctor-tool-plan.js";

export interface DoctorEngineRow {
	engine: string;
	tool: string;
	status: "ok" | "missing" | "skipped";
	remediation?: string;
	skipReason?: string;
}

export interface PlanContext {
	rootDirectory: string;
	projectInfo: ProjectInfo;
	config: AislopConfig;
}

export interface ToolDecision {
	tool: string;
	status: "ok" | "missing" | "skipped";
	remediation?: string;
	skipReason?: string;
}

const primaryLanguage = (langs: Language[]): Language | null => {
	// Prefer explicit ordering: JS/TS -> Python -> Go -> Rust -> Ruby -> PHP -> Java
	// -> C# -> C/C++. Every language has to appear here or a mixed project falls
	// through to the bare "mixed" label with no headline language.
	const order: Language[] = [
		"typescript",
		"javascript",
		"python",
		"go",
		"rust",
		"ruby",
		"php",
		"java",
		"csharp",
		"cpp",
	];
	for (const lang of order) {
		if (langs.includes(lang)) return lang;
	}
	return null;
};

// Minimal synthetic PlanContext for the *ForTest entry points below.
interface TestPlanOverrides {
	languages: Language[];
	installedTools: Record<string, boolean>;
	projectEvaluation?: boolean;
}

const makeTestPlanContext = (overrides: TestPlanOverrides): PlanContext => ({
	rootDirectory: path.join(path.sep, "aislop-doctor-test-nonexistent"),
	projectInfo: {
		rootDirectory: path.join(path.sep, "aislop-doctor-test-nonexistent"),
		projectName: "test",
		languages: overrides.languages,
		frameworks: [],
		sourceFileCount: 0,
		coverage: {
			supportedFiles: 0,
			unsupportedFiles: 0,
			dominantUnsupported: null,
			scoreable: false,
		},
		installedTools: overrides.installedTools,
	},
	config: {
		...DEFAULT_CONFIG,
		lint: {
			...DEFAULT_CONFIG.lint,
			csharp: {
				...DEFAULT_CONFIG.lint.csharp,
				projectEvaluation: overrides.projectEvaluation ?? false,
			},
		},
	},
});

/** Exported for unit tests only. Runs planFormat with a minimal synthetic context. */
export const planFormatForTest = (overrides: TestPlanOverrides): ToolDecision =>
	planFormat(makeTestPlanContext(overrides));

/** Exported for unit tests only. Runs planLint with a minimal synthetic context. */
export const planLintForTest = (overrides: TestPlanOverrides): ToolDecision =>
	planLint(makeTestPlanContext(overrides));

const planCodeQuality = (ctx: PlanContext): ToolDecision => {
	if (
		ctx.projectInfo.languages.includes("typescript") ||
		ctx.projectInfo.languages.includes("javascript")
	) {
		return { tool: "knip (bundled)", status: "ok" };
	}
	return { tool: "built-in", status: "ok" };
};

const planAiSlop = (_ctx: PlanContext): ToolDecision => ({
	tool: "built-in",
	status: "ok",
});

export const planSecurityForTest = (overrides: TestPlanOverrides): ToolDecision =>
	planSecurity(makeTestPlanContext(overrides));

const planArchitecture = (ctx: PlanContext): ToolDecision => {
	if (!ctx.config.engines.architecture) {
		return { tool: "opt-in", status: "skipped", skipReason: "not configured" };
	}
	const rulesPath = path.join(ctx.rootDirectory, CONFIG_DIR, RULES_FILE);
	if (!fs.existsSync(rulesPath)) {
		return { tool: "opt-in", status: "skipped", skipReason: "no rules file" };
	}
	const rules = loadArchitectureRules(rulesPath);
	if (rules.length === 0) {
		return { tool: "opt-in", status: "skipped", skipReason: "rules file empty" };
	}
	return { tool: `custom rules (${rules.length} defined)`, status: "ok" };
};

const ENGINE_PLANNERS: Record<EngineName, (ctx: PlanContext) => ToolDecision> = {
	format: planFormat,
	lint: planLint,
	"code-quality": planCodeQuality,
	"ai-slop": planAiSlop,
	architecture: planArchitecture,
	security: planSecurity,
};

const ENGINE_ORDER: EngineName[] = [
	"format",
	"lint",
	"code-quality",
	"ai-slop",
	"security",
	"architecture",
];

export const languageLabelFor = (info: ProjectInfo): string => {
	const langs = info.languages.filter((l) => l !== "java"); // java is a signal-only placeholder
	if (langs.length === 0) return info.languages[0] ?? "unknown";
	if (langs.length === 1) return langs[0];
	const primary = primaryLanguage(langs);
	return primary ? `${primary} (mixed)` : "mixed";
};

export const buildRows = (ctx: PlanContext): DoctorEngineRow[] => {
	const rows: DoctorEngineRow[] = [];
	for (const engine of ENGINE_ORDER) {
		// Respect the user's engine config - if they disabled it, skip entirely
		// except for architecture, which we always show (so users know it's available).
		if (engine !== "architecture" && ctx.config.engines[engine] === false) continue;

		const decision = ENGINE_PLANNERS[engine](ctx);
		rows.push({
			engine: getEngineLabel(engine),
			tool: decision.tool,
			status: decision.status,
			remediation: decision.remediation,
			skipReason: decision.skipReason,
		});
	}
	return rows;
};
