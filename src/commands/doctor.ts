import fs from "node:fs";
import path from "node:path";
import { type AislopConfig, CONFIG_DIR, loadConfig, RULES_FILE } from "../config/index.js";
import { loadArchitectureRules } from "../engines/architecture/rule-loader.js";
import type { EngineName } from "../engines/types.js";
import { getEngineLabel } from "../output/engine-info.js";
import { renderHeader } from "../ui/header.js";
import { detectInvocation } from "../ui/invocation.js";
import { renderHintLine } from "../ui/logger.js";
import { type RailStep, renderRail } from "../ui/rail.js";
import { createSymbols } from "../ui/symbols.js";
import { createTheme, style, type Theme } from "../ui/theme.js";
import { padEnd } from "../ui/width.js";
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

const renderToolCell = (theme: Theme, row: DoctorEngineRow): string => {
	if (row.status === "missing") {
		return style(theme, "danger", row.tool);
	}
	if (row.status === "skipped") {
		const combined = row.skipReason ? `${row.tool} · ${row.skipReason}` : row.tool;
		return style(theme, "muted", combined);
	}
	return style(theme, "muted", row.tool);
};

export const buildDoctorRender = (input: BuildDoctorRenderInput): string => {
	const theme = createTheme();
	const symbols = createSymbols({ plain: false });
	const deps = { theme, symbols };

	const header = renderHeader(
		{
			version: APP_VERSION,
			command: "doctor",
			context: [input.projectName, input.languageLabel].filter((s) => s.length > 0),
			brand: input.printBrand !== false,
		},
		deps,
	);

	const labelWidth = Math.max(12, ...input.rows.map((r) => r.engine.length)) + 2;
	const enginesRunning = input.rows.filter((r) => r.status === "ok").length;
	const missing = input.rows.filter((r) => r.status === "missing").length;

	const steps: RailStep[] = input.rows.map((row) => {
		const engineCol = padEnd(row.engine, labelWidth);
		const toolCell = renderToolCell(theme, row);
		const label = `${engineCol}${toolCell}`;

		if (row.status === "missing") {
			return {
				status: "failed",
				label,
				notes: row.remediation ? [row.remediation] : undefined,
			};
		}
		if (row.status === "skipped") {
			return { status: "skipped", label };
		}
		return { status: "done", label };
	});

	const footer = `Ready · ${enginesRunning} engines · ${missing} missing`;

	const rail = renderRail({ steps, footer }, deps);

	const hintText =
		missing > 0
			? `Install the missing tools, then run ${input.invocation} scan`
			: `Run ${input.invocation} scan to check this project`;
	const tail = `\n${renderHintLine(hintText, deps)}`;
	return `${header}${rail}${tail}`;
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

const planFormat = (ctx: PlanContext): ToolDecision => {
	const { languages, installedTools } = ctx.projectInfo;
	if (hasJsLike(languages)) {
		return { tool: "biome (bundled)", status: "ok" };
	}
	if (languages.includes("python")) {
		return installedTools["ruff"]
			? { tool: "ruff (system)", status: "ok" }
			: {
					tool: "ruff not found",
					status: "missing",
					remediation: "Install: pipx install ruff",
				};
	}
	if (languages.includes("go")) {
		return installedTools["gofmt"]
			? { tool: "gofmt (system)", status: "ok" }
			: {
					tool: "gofmt not found",
					status: "missing",
					remediation: "Install: via go toolchain — https://go.dev/dl/",
				};
	}
	if (languages.includes("rust")) {
		return installedTools["cargo"]
			? { tool: "cargo fmt (system)", status: "ok" }
			: {
					tool: "cargo fmt not found",
					status: "missing",
					remediation: "Install: rustup component add rustfmt",
				};
	}
	if (languages.includes("ruby")) {
		return installedTools["rubocop"]
			? { tool: "rubocop (system)", status: "ok" }
			: {
					tool: "rubocop not found",
					status: "missing",
					remediation: "Install: gem install rubocop",
				};
	}
	if (languages.includes("php")) {
		return installedTools["php-cs-fixer"]
			? { tool: "php-cs-fixer (system)", status: "ok" }
			: {
					tool: "php-cs-fixer not found",
					status: "missing",
					remediation: "Install: composer global require friendsofphp/php-cs-fixer",
				};
	}
	return { tool: "no formatter", status: "skipped", skipReason: "no supported language" };
};

const planLint = (ctx: PlanContext): ToolDecision => {
	const { languages, frameworks, installedTools } = ctx.projectInfo;
	if (frameworks.includes("expo")) {
		return { tool: "expo-doctor + oxlint (bundled)", status: "ok" };
	}
	if (hasJsLike(languages)) {
		return { tool: "oxlint (bundled)", status: "ok" };
	}
	if (languages.includes("python")) {
		return installedTools["ruff"]
			? { tool: "ruff (system)", status: "ok" }
			: {
					tool: "ruff not found",
					status: "missing",
					remediation: "Install: pipx install ruff",
				};
	}
	if (languages.includes("go")) {
		return installedTools["golangci-lint"]
			? { tool: "golangci-lint (system)", status: "ok" }
			: {
					tool: "golangci-lint not found",
					status: "missing",
					remediation: "Install: brew install golangci-lint",
				};
	}
	if (languages.includes("rust")) {
		return installedTools["clippy-driver"]
			? { tool: "clippy (system)", status: "ok" }
			: {
					tool: "clippy not found",
					status: "missing",
					remediation: "Install: rustup component add clippy",
				};
	}
	if (languages.includes("ruby")) {
		return installedTools["rubocop"]
			? { tool: "rubocop (system)", status: "ok" }
			: {
					tool: "rubocop not found",
					status: "missing",
					remediation: "Install: gem install rubocop",
				};
	}
	return { tool: "no linter", status: "skipped", skipReason: "no supported language" };
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

const planSecurity = (ctx: PlanContext): ToolDecision => {
	const { rootDirectory, projectInfo } = ctx;
	const { installedTools } = projectInfo;

	const hasFile = (rel: string): boolean => fs.existsSync(path.join(rootDirectory, rel));

	if (hasFile("pnpm-lock.yaml")) {
		return { tool: "pnpm audit", status: "ok" };
	}
	if (hasFile("package-lock.json")) {
		return { tool: "npm audit", status: "ok" };
	}
	if (hasFile("requirements.txt") || hasFile("poetry.lock") || hasFile("Pipfile.lock")) {
		return installedTools["pip-audit"]
			? { tool: "pip-audit (system)", status: "ok" }
			: {
					tool: "pip-audit not found",
					status: "missing",
					remediation: "Install: pipx install pip-audit",
				};
	}
	if (hasFile("Cargo.toml")) {
		return installedTools["cargo"] && installedTools["cargo-audit"]
			? { tool: "cargo audit (system)", status: "ok" }
			: {
					tool: "cargo audit not found",
					status: "missing",
					remediation: "Install: cargo install cargo-audit",
				};
	}
	if (hasFile("go.mod")) {
		return installedTools["govulncheck"]
			? { tool: "govulncheck (system)", status: "ok" }
			: {
					tool: "govulncheck not found",
					status: "missing",
					remediation: "Install: go install golang.org/x/vuln/cmd/govulncheck@latest",
				};
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
