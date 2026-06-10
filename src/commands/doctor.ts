import fs from "node:fs";
import path from "node:path";
import { type AislopConfig, CONFIG_DIR, loadConfig, RULES_FILE } from "../config/index.js";
import { loadArchitectureRules } from "../engines/architecture/rule-loader.js";
import { resolveTrustedTscPath } from "../engines/lint/typecheck.js";
import type { EngineName } from "../engines/types.js";
import { getEngineLabel } from "../output/engine-info.js";
import {
	type DisplayRow,
	type DisplayStatusItem,
	renderDisplayRows,
	renderDisplaySection,
	renderDisplayStatusItems,
} from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { detectInvocation } from "../ui/invocation.js";
import { style, theme } from "../ui/theme.js";
import { discoverProject, type Language, type ProjectInfo } from "../utils/discover.js";
import { APP_VERSION } from "../version.js";

export interface DoctorEngineRow {
	engine: string;
	tool: string;
	status: "ok" | "missing" | "skipped";
	remediation?: string;
	skipReason?: string;
}

interface BuildDoctorRenderInput {
	projectName: string;
	languageLabel: string;
	rows: DoctorEngineRow[];
	invocation: string;
	printBrand?: boolean;
}

const doctorMarker = (row: DoctorEngineRow): string => {
	if (row.status === "missing") return style(theme, "danger", "✗");
	if (row.status === "skipped") return style(theme, "muted", "·");
	return style(theme, "success", "✓");
};

const doctorState = (row: DoctorEngineRow): string => {
	if (row.status === "missing") return "missing";
	if (row.status === "skipped") return "skipped";
	return "ready";
};

const renderToolCell = (row: DoctorEngineRow): string => {
	if (row.status === "missing") {
		return style(theme, "danger", row.tool);
	}
	return style(theme, "muted", row.tool);
};

const doctorItem = (row: DoctorEngineRow): DisplayStatusItem => {
	const rows: DisplayRow[] = [
		{ label: "Status", value: doctorState(row) },
		{ label: "Tool", value: renderToolCell(row) },
	];
	if (row.skipReason) rows.push({ label: "Reason", value: row.skipReason });
	if (row.remediation) rows.push({ label: "Fix", value: row.remediation });
	return { marker: doctorMarker(row), label: row.engine, rows };
};

export const buildDoctorRender = (input: BuildDoctorRenderInput): string => {
	const header = renderHeader({
		version: APP_VERSION,
		command: "Doctor report",
		context: [input.projectName, input.languageLabel].filter((s) => s.length > 0),
		brand: input.printBrand !== false,
	});

	const enginesRunning = input.rows.filter((r) => r.status === "ok").length;
	const missing = input.rows.filter((r) => r.status === "missing").length;
	const skipped = input.rows.filter((r) => r.status === "skipped").length;
	const nextRows: DisplayRow[] =
		missing > 0
			? [
					{ label: "Action", value: "Install the missing tools" },
					{ label: "Then", value: `${input.invocation} scan` },
				]
			: [{ label: "Scan", value: `${input.invocation} scan` }];

	const lines = [
		header.trimEnd(),
		"",
		renderDisplaySection("Engines"),
		...renderDisplayStatusItems(input.rows.map(doctorItem)),
		"",
		renderDisplaySection("Summary"),
		...renderDisplayRows([
			{ label: "Ready", value: `${enginesRunning} engines` },
			{ label: "Missing", value: String(missing) },
			{ label: "Skipped", value: String(skipped) },
		]),
		"",
		renderDisplaySection(missing > 0 ? "Fix" : "Next"),
		...renderDisplayRows(nextRows),
	];
	return `${lines.join("\n")}\n`;
};

interface PlanContext {
	rootDirectory: string;
	projectInfo: ProjectInfo;
	config: AislopConfig;
}

interface ToolDecision {
	tool: string;
	status: "ok" | "missing" | "skipped";
	remediation?: string;
	skipReason?: string;
}

const hasAnyLanguage = (langs: Language[], wanted: Language[]): boolean =>
	wanted.some((l) => langs.includes(l));

const hasJsLike = (langs: Language[]): boolean =>
	hasAnyLanguage(langs, ["typescript", "javascript"]);

const primaryLanguage = (langs: Language[]): Language | null => {
	// Prefer explicit ordering: JS/TS -> Python -> Go -> Rust -> Ruby -> PHP -> Java
	const order: Language[] = [
		"typescript",
		"javascript",
		"python",
		"go",
		"rust",
		"ruby",
		"php",
		"java",
	];
	for (const lang of order) {
		if (langs.includes(lang)) return lang;
	}
	return null;
};

interface SystemToolSpec {
	binary: string;
	toolLabel: string;
	remediation: string;
}

interface LangToolSpec extends SystemToolSpec {
	language: Language;
}

const systemToolDecision = (
	installed: Record<string, boolean>,
	spec: SystemToolSpec,
): ToolDecision =>
	installed[spec.binary]
		? { tool: `${spec.toolLabel} (system)`, status: "ok" }
		: {
				tool: `${spec.toolLabel} not found`,
				status: "missing",
				remediation: spec.remediation,
			};

const firstMatching = (
	langs: Language[],
	installed: Record<string, boolean>,
	specs: LangToolSpec[],
): ToolDecision | null => {
	for (const spec of specs) {
		if (langs.includes(spec.language)) return systemToolDecision(installed, spec);
	}
	return null;
};

const spec = (
	language: Language,
	binary: string,
	toolLabel: string,
	remediation: string,
): LangToolSpec => ({ language, binary, toolLabel, remediation });

const FORMAT_SPECS: LangToolSpec[] = [
	spec("python", "ruff", "ruff", "Install: pipx install ruff"),
	spec("go", "gofmt", "gofmt", "Install: via go toolchain — https://go.dev/dl/"),
	spec("rust", "cargo", "cargo fmt", "Install: rustup component add rustfmt"),
	spec("ruby", "rubocop", "rubocop", "Install: gem install rubocop"),
	spec(
		"php",
		"php-cs-fixer",
		"php-cs-fixer",
		"Install: composer global require friendsofphp/php-cs-fixer",
	),
];

const LINT_SPECS: LangToolSpec[] = [
	spec("python", "ruff", "ruff", "Install: pipx install ruff"),
	spec("go", "golangci-lint", "golangci-lint", "Install: brew install golangci-lint"),
	spec("rust", "clippy-driver", "clippy", "Install: rustup component add clippy"),
	spec("ruby", "rubocop", "rubocop", "Install: gem install rubocop"),
];

const planFormat = (ctx: PlanContext): ToolDecision => {
	const { languages, installedTools } = ctx.projectInfo;
	if (hasJsLike(languages)) return { tool: "biome (bundled)", status: "ok" };
	return (
		firstMatching(languages, installedTools, FORMAT_SPECS) ?? {
			tool: "no formatter",
			status: "skipped",
			skipReason: "no supported language",
		}
	);
};

const withTypecheckSuffix = (baseTool: string, ctx: PlanContext): ToolDecision => {
	if (!ctx.config.lint?.typecheck) return { tool: baseTool, status: "ok" };
	if (resolveTrustedTscPath()) {
		return { tool: `${baseTool} + bundled tsc`, status: "ok" };
	}
	return {
		tool: `${baseTool} + bundled tsc not found`,
		status: "missing",
		remediation:
			"Reinstall aislop so its TypeScript dependency is available, or set lint.typecheck: false in .aislop/config.yml.",
	};
};

const planLint = (ctx: PlanContext): ToolDecision => {
	const { languages, frameworks, installedTools } = ctx.projectInfo;
	if (frameworks.includes("expo") && ctx.config.lint?.expoDoctor) {
		return withTypecheckSuffix("expo-doctor + oxlint (bundled)", ctx);
	}
	if (hasJsLike(languages)) return withTypecheckSuffix("oxlint (bundled)", ctx);
	return (
		firstMatching(languages, installedTools, LINT_SPECS) ?? {
			tool: "no linter",
			status: "skipped",
			skipReason: "no supported language",
		}
	);
};

const planCodeQuality = (ctx: PlanContext): ToolDecision => {
	if (hasJsLike(ctx.projectInfo.languages)) {
		return { tool: "knip (bundled)", status: "ok" };
	}
	return { tool: "built-in", status: "ok" };
};

const planAiSlop = (_ctx: PlanContext): ToolDecision => ({
	tool: "built-in",
	status: "ok",
});

interface AuditSpec {
	files: string[];
	bundled?: string;
	systemTool?: SystemToolSpec & { requiresBinaries?: string[] };
}

const AUDIT_SPECS: AuditSpec[] = [
	{ files: ["pnpm-lock.yaml"], bundled: "pnpm audit" },
	{ files: ["package-lock.json"], bundled: "npm audit" },
	{
		files: ["requirements.txt", "poetry.lock", "Pipfile.lock"],
		systemTool: {
			binary: "pip-audit",
			toolLabel: "pip-audit",
			remediation: "Install: pipx install pip-audit",
		},
	},
	{
		files: ["Cargo.toml"],
		systemTool: {
			binary: "cargo-audit",
			toolLabel: "cargo audit",
			remediation: "Install: cargo install cargo-audit",
			requiresBinaries: ["cargo", "cargo-audit"],
		},
	},
	{
		files: ["go.mod"],
		systemTool: {
			binary: "govulncheck",
			toolLabel: "govulncheck",
			remediation: "Install: go install golang.org/x/vuln/cmd/govulncheck@latest",
		},
	},
];

const planSecurity = (ctx: PlanContext): ToolDecision => {
	const { rootDirectory, projectInfo } = ctx;
	const { installedTools } = projectInfo;
	const hasFile = (rel: string): boolean => fs.existsSync(path.join(rootDirectory, rel));
	for (const spec of AUDIT_SPECS) {
		if (!spec.files.some(hasFile)) continue;
		if (spec.bundled) return { tool: spec.bundled, status: "ok" };
		if (spec.systemTool) {
			const required = spec.systemTool.requiresBinaries ?? [spec.systemTool.binary];
			const allPresent = required.every((b) => installedTools[b]);
			return allPresent
				? { tool: `${spec.systemTool.toolLabel} (system)`, status: "ok" }
				: {
						tool: `${spec.systemTool.toolLabel} not found`,
						status: "missing",
						remediation: spec.systemTool.remediation,
					};
		}
	}
	return { tool: "no auditor", status: "skipped", skipReason: "no lockfile" };
};

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

const languageLabelFor = (info: ProjectInfo): string => {
	const langs = info.languages.filter((l) => l !== "java"); // java is a signal-only placeholder
	if (langs.length === 0) return info.languages[0] ?? "unknown";
	if (langs.length === 1) return langs[0];
	const primary = primaryLanguage(langs);
	return primary ? `${primary} (mixed)` : "mixed";
};

const buildRows = (ctx: PlanContext): DoctorEngineRow[] => {
	const rows: DoctorEngineRow[] = [];
	for (const engine of ENGINE_ORDER) {
		// Respect the user's engine config — if they disabled it, skip entirely
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

interface DoctorOptions {
	printBrand?: boolean;
}

export const doctorCommand = async (
	directory: string,
	options: DoctorOptions = {},
): Promise<void> => {
	const resolvedDir = path.resolve(directory);
	const projectInfo = await discoverProject(resolvedDir);
	const config = loadConfig(resolvedDir);

	const rows = buildRows({ rootDirectory: resolvedDir, projectInfo, config });

	process.stdout.write(
		buildDoctorRender({
			projectName: projectInfo.projectName,
			languageLabel: languageLabelFor(projectInfo),
			rows,
			invocation: detectInvocation(),
			printBrand: options.printBrand,
		}),
	);
};
