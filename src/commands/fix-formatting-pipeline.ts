import { fixBiomeFormat, runBiomeFormat } from "../engines/format/biome.js";
import { fixClangFormat, runClangFormat } from "../engines/format/clang-format.js";
import {
	buildDotnetFormatExcludeScope,
	fixDotnetFormat,
	runDotnetFormat,
} from "../engines/format/dotnet-format.js";
import { fixGenericFormatter, runGenericFormatter } from "../engines/format/generic.js";
import { fixGofmt, runGofmt } from "../engines/format/gofmt.js";
import { fixRuffFormat, runRuffFormat } from "../engines/format/ruff-format.js";
import { log } from "../ui/logger.js";
import type { PipelineDeps } from "./fix-pipeline.js";
import { hasJsOrTs } from "./fix-pipeline-language.js";
import { CANNOT_SCOPE_REASON, isScopedFix } from "./fix-scope.js";

const skipUnsafeSafeFormatter = (deps: PipelineDeps, language: "ruby" | "php"): boolean => {
	if (!deps.safe) return false;
	const tool = language === "ruby" ? "rubocop" : "php-cs-fixer";
	const label = language === "ruby" ? "Ruby" : "PHP";
	log.warn(
		`Safe mode skips ${label} formatting because ${tool} can execute project-controlled configuration. Run \`aislop fix\` without --safe if you trust this repository.`,
	);
	return true;
};

// dotnet format rewrites a whole solution or project at a time and can only be
// scoped with the plain paths and `*`/`**` globs its matcher understands. When
// an exclude pattern falls outside that syntax there is no way to keep the
// rewrite off the excluded files, so the step is skipped with the reason rather
// than run over code the user asked aislop to leave alone.
const skipUnscopableCsharpFormatter = (deps: PipelineDeps): boolean => {
	const { unsupportedPatterns } = buildDotnetFormatExcludeScope(deps.context.excludePatterns);
	if (unsupportedPatterns.length === 0) return false;
	log.warn(
		`Skipping C# formatting: dotnet format cannot exclude ${unsupportedPatterns.join(", ")}. Rewrite those exclude patterns with plain paths, \`*\`, or \`**\` to have C# formatted around them.`,
	);
	return true;
};

export const runFormattingStep = async (deps: PipelineDeps): Promise<void> => {
	if (!deps.config.engines.format) return;

	if (hasJsOrTs(deps.projectInfo)) {
		await deps.runStep(
			"Formatting (js/ts)",
			() => runBiomeFormat(deps.context),
			() => fixBiomeFormat(deps.context),
		);
	}

	if (deps.projectInfo.languages.includes("python") && deps.projectInfo.installedTools.ruff) {
		await deps.runStep(
			"Formatting (python)",
			() => runRuffFormat(deps.context),
			() => fixRuffFormat(deps.context),
		);
	} else if (deps.projectInfo.languages.includes("python")) {
		log.warn("Python detected but ruff is not installed; skipping Python formatting fixes.");
	}

	if (deps.projectInfo.languages.includes("go") && deps.projectInfo.installedTools.gofmt) {
		await deps.runStep(
			"Formatting (go)",
			() => runGofmt(deps.context),
			() => fixGofmt(deps.context),
		);
	} else if (deps.projectInfo.languages.includes("go")) {
		log.warn("Go detected but gofmt is not installed; skipping Go formatting fixes.");
	}

	if (deps.projectInfo.languages.includes("rust") && deps.projectInfo.installedTools.rustfmt) {
		if (isScopedFix(deps.context)) {
			deps.skipStep?.("Formatting (rust)", CANNOT_SCOPE_REASON);
		} else {
			await deps.runStep(
				"Formatting (rust)",
				() => runGenericFormatter(deps.context, "rust"),
				() => fixGenericFormatter(deps.context, "rust"),
			);
		}
	} else if (deps.projectInfo.languages.includes("rust")) {
		log.warn("Rust detected but rustfmt is not installed; skipping Rust formatting fixes.");
	}

	if (deps.projectInfo.languages.includes("ruby") && deps.projectInfo.installedTools.rubocop) {
		if (!skipUnsafeSafeFormatter(deps, "ruby")) {
			await deps.runStep(
				"Formatting (ruby)",
				() => runGenericFormatter(deps.context, "ruby"),
				() => fixGenericFormatter(deps.context, "ruby"),
			);
		}
	} else if (deps.projectInfo.languages.includes("ruby")) {
		log.warn("Ruby detected but rubocop is not installed; skipping Ruby formatting fixes.");
	}

	if (
		deps.projectInfo.languages.includes("php") &&
		deps.projectInfo.installedTools["php-cs-fixer"]
	) {
		if (!skipUnsafeSafeFormatter(deps, "php")) {
			await deps.runStep(
				"Formatting (php)",
				() => runGenericFormatter(deps.context, "php"),
				() => fixGenericFormatter(deps.context, "php"),
			);
		}
	} else if (deps.projectInfo.languages.includes("php")) {
		log.warn("PHP detected but php-cs-fixer is not installed; skipping PHP formatting fixes.");
	}

	await runNativeFormattingSteps(deps);
};

const runNativeFormattingSteps = async (deps: PipelineDeps): Promise<void> => {
	if (deps.projectInfo.languages.includes("csharp") && deps.projectInfo.installedTools.dotnet) {
		if (deps.context.config.lint?.csharp?.projectEvaluation !== true) {
			log.warn(
				"Skipping C# formatting: set lint.csharp.projectEvaluation: true only for repositories you trust.",
			);
		} else if (isScopedFix(deps.context)) {
			deps.skipStep?.("Formatting (csharp)", CANNOT_SCOPE_REASON);
		} else if (!skipUnscopableCsharpFormatter(deps)) {
			await deps.runStep(
				"Formatting (csharp)",
				() => runDotnetFormat(deps.context),
				() => fixDotnetFormat(deps.context),
			);
		}
	} else if (deps.projectInfo.languages.includes("csharp")) {
		log.warn("C# detected but dotnet is not installed; skipping C# formatting fixes.");
	}

	if (
		deps.projectInfo.languages.includes("cpp") &&
		deps.projectInfo.installedTools["clang-format"]
	) {
		await deps.runStep(
			"Formatting (cpp)",
			() => runClangFormat(deps.context),
			() => fixClangFormat(deps.context),
		);
	} else if (deps.projectInfo.languages.includes("cpp")) {
		log.warn("C/C++ detected but clang-format is not installed; skipping C/C++ formatting fixes.");
	}
};
