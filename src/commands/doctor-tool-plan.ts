import { resolveTrustedTscPath } from "../engines/lint/typecheck.js";
import type { Language } from "../utils/discover.js";
import type { PlanContext, ToolDecision } from "./doctor-plan.js";
import { projectEvaluationGate } from "./doctor-trust-plan.js";

interface SystemToolSpec {
	binary: string;
	toolLabel: string;
	remediation: string;
}

interface LangToolSpec extends SystemToolSpec {
	language: Language;
}

interface MatchedToolDecision {
	language: Language;
	decision: ToolDecision;
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
	languages: Language[],
	installed: Record<string, boolean>,
	specs: LangToolSpec[],
): MatchedToolDecision | null => {
	let firstLanguageMatch: LangToolSpec | null = null;
	for (const spec of specs) {
		if (!languages.includes(spec.language)) continue;
		if (firstLanguageMatch === null) firstLanguageMatch = spec;
		if (installed[spec.binary]) {
			return { language: spec.language, decision: systemToolDecision(installed, spec) };
		}
	}
	return firstLanguageMatch
		? {
				language: firstLanguageMatch.language,
				decision: systemToolDecision(installed, firstLanguageMatch),
			}
		: null;
};

const applyProjectEvaluationGate = (
	ctx: PlanContext,
	matched: MatchedToolDecision | null,
	specs: LangToolSpec[],
): ToolDecision | null => {
	if (matched?.language !== "csharp" || ctx.config.lint.csharp?.projectEvaluation === true) {
		return matched?.decision ?? null;
	}
	const fallback = firstMatching(
		ctx.projectInfo.languages,
		ctx.projectInfo.installedTools,
		specs.filter((candidate) => candidate.language !== "csharp"),
	);
	return fallback?.decision.status === "ok" ? fallback.decision : projectEvaluationGate();
};

const spec = (
	language: Language,
	binary: string,
	toolLabel: string,
	remediation: string,
): LangToolSpec => ({ language, binary, toolLabel, remediation });

const FORMAT_SPECS: LangToolSpec[] = [
	spec("python", "ruff", "ruff", "Install: pipx install ruff"),
	spec("go", "gofmt", "gofmt", "Install: via go toolchain: https://go.dev/dl/"),
	spec("rust", "cargo", "cargo fmt", "Install: rustup component add rustfmt"),
	spec("ruby", "rubocop", "rubocop", "Install: gem install rubocop"),
	spec(
		"php",
		"php-cs-fixer",
		"php-cs-fixer",
		"Install: composer global require friendsofphp/php-cs-fixer",
	),
	spec(
		"csharp",
		"dotnet",
		"dotnet format whitespace",
		"Install the .NET SDK: https://dotnet.microsoft.com/download",
	),
	spec(
		"cpp",
		"clang-format",
		"clang-format",
		"Install LLVM: apt-get install clang-format | brew install clang-format | winget install LLVM.LLVM",
	),
];

const LINT_SPECS: LangToolSpec[] = [
	spec("python", "ruff", "ruff", "Install: pipx install ruff"),
	spec("go", "golangci-lint", "golangci-lint", "Install: brew install golangci-lint"),
	spec("rust", "clippy-driver", "clippy", "Install: rustup component add clippy"),
	spec("ruby", "rubocop", "rubocop", "Install: gem install rubocop"),
	spec(
		"csharp",
		"jb",
		"jb inspectcode",
		"Install: dotnet tool install -g JetBrains.ReSharper.GlobalTools",
	),
	spec(
		"csharp",
		"roslynator",
		"roslynator",
		"Install: dotnet tool install -g roslynator.dotnet.cli",
	),
	spec(
		"cpp",
		"cppcheck",
		"cppcheck",
		"Install: apt-get install cppcheck | brew install cppcheck | winget install Cppcheck.Cppcheck",
	),
	spec(
		"cpp",
		"clang-tidy",
		"clang-tidy",
		"Install LLVM: apt-get install clang-tidy | brew install llvm | winget install LLVM.LLVM",
	),
];

const hasJsLike = (languages: Language[]): boolean =>
	languages.includes("typescript") || languages.includes("javascript");

export const planFormat = (ctx: PlanContext): ToolDecision => {
	const { languages, installedTools } = ctx.projectInfo;
	if (hasJsLike(languages)) return { tool: "biome (bundled)", status: "ok" };
	return (
		applyProjectEvaluationGate(
			ctx,
			firstMatching(languages, installedTools, FORMAT_SPECS),
			FORMAT_SPECS,
		) ?? { tool: "no formatter", status: "skipped", skipReason: "no supported language" }
	);
};

const withTypecheckSuffix = (baseTool: string, ctx: PlanContext): ToolDecision => {
	if (!ctx.config.lint?.typecheck) return { tool: baseTool, status: "ok" };
	if (resolveTrustedTscPath()) return { tool: `${baseTool} + bundled tsc`, status: "ok" };
	return {
		tool: `${baseTool} + bundled tsc not found`,
		status: "missing",
		remediation:
			"Reinstall aislop so its TypeScript dependency is available, or set lint.typecheck: false in .aislop/config.yml.",
	};
};

export const planLint = (ctx: PlanContext): ToolDecision => {
	const { languages, frameworks, installedTools } = ctx.projectInfo;
	if (frameworks.includes("expo") && ctx.config.lint?.expoDoctor) {
		return withTypecheckSuffix("expo-doctor + oxlint (bundled)", ctx);
	}
	if (hasJsLike(languages)) return withTypecheckSuffix("oxlint (bundled)", ctx);
	return (
		applyProjectEvaluationGate(
			ctx,
			firstMatching(languages, installedTools, LINT_SPECS),
			LINT_SPECS,
		) ?? { tool: "no linter", status: "skipped", skipReason: "no supported language" }
	);
};
