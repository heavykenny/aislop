import type { AislopConfig } from "../config/index.js";
import { detectTrivialComments } from "../engines/ai-slop/comments.js";
import { detectDeadPatterns } from "../engines/ai-slop/dead-patterns.js";
import { fixDeadPatterns } from "../engines/ai-slop/dead-patterns-fix.js";
import { detectUnusedImports } from "../engines/ai-slop/unused-imports.js";
import { fixUnusedImports } from "../engines/ai-slop/unused-imports-fix.js";
import {
	fixUnusedDependencies,
	fixUnusedFiles,
	runKnipDependencyCheck,
	runKnipUnusedFiles,
} from "../engines/code-quality/knip.js";
import {
	detectUnusedDeclarations,
	diagnosticsToDeclarations,
	removeUnusedDeclarations,
} from "../engines/code-quality/unused-removal.js";
import { fixBiomeFormat, runBiomeFormat } from "../engines/format/biome.js";
import { fixGofmt, runGofmt } from "../engines/format/gofmt.js";
import { fixRuffFormat, runRuffFormat } from "../engines/format/ruff-format.js";
import { runExpoDoctor } from "../engines/lint/expo-doctor.js";
import { fixOxlint, runOxlint } from "../engines/lint/oxlint.js";
import { fixRuffLint, fixRuffLintForce, runRuffLint } from "../engines/lint/ruff.js";
import { runDependencyAudit } from "../engines/security/audit.js";
import type { Diagnostic, EngineContext } from "../engines/types.js";
import { log } from "../ui/logger.js";
import type { discoverProject } from "../utils/discover.js";
import { fixDependencyAudit, fixExpoDependencies } from "./fix-force.js";
import type { FixStepResult } from "./fix-steps.js";

export type ProjectInfo = Awaited<ReturnType<typeof discoverProject>>;

export type RunStepFn = (
	name: string,
	detect: () => Promise<Diagnostic[]>,
	applyFix: () => Promise<void>,
) => Promise<FixStepResult>;

export interface PipelineDeps {
	rail: { start: (name: string) => void };
	context: EngineContext;
	config: AislopConfig;
	resolvedDir: string;
	projectInfo: ProjectInfo;
	force: boolean;
	runStep: RunStepFn;
}

const hasJsOrTs = (projectInfo: ProjectInfo): boolean =>
	projectInfo.languages.includes("typescript") || projectInfo.languages.includes("javascript");

export const runAiSlopSteps = async (deps: PipelineDeps): Promise<void> => {
	if (!deps.config.engines["ai-slop"]) return;

	await deps.runStep(
		"Unused imports",
		() => detectUnusedImports(deps.context),
		() => fixUnusedImports(deps.context),
	);

	const detectFixableSlop = async () => {
		const [comments, dead] = await Promise.all([
			detectTrivialComments(deps.context),
			detectDeadPatterns(deps.context),
		]);
		return [...comments, ...dead].filter((d) => d.fixable);
	};

	await deps.runStep("Dead code & comments", detectFixableSlop, () =>
		fixDeadPatterns(deps.context),
	);
};

// Consolidated dead-declaration cleanup: oxlint's unused-vars diagnostics
// (local top-level decls) plus knip's exports/types/duplicates (exported
// but unimported symbols) feed into our own engine. The engine parses
// each file with the TypeScript compiler, applies a side-effect guard on
// initializers, and verifies the file still parses before writing —
// removing the full statement including any `export` keyword. Neither
// oxlint's nor knip's built-in `--fix` can do this without damaging files,
// so this step owns the whole operation.
export const runDeclarationStep = async (deps: PipelineDeps): Promise<void> => {
	if (!deps.config.engines["code-quality"]) return;
	if (!hasJsOrTs(deps.projectInfo)) return;

	await deps.runStep(
		"Unused declarations",
		() => detectUnusedDeclarations(deps.context),
		async () => {
			const diagnostics = await detectUnusedDeclarations(deps.context);
			const declarations = diagnosticsToDeclarations(diagnostics);
			removeUnusedDeclarations(deps.resolvedDir, declarations);
		},
	);
};

export const runLintSteps = async (deps: PipelineDeps): Promise<void> => {
	if (!deps.config.engines.lint) return;

	if (hasJsOrTs(deps.projectInfo)) {
		await deps.runStep(
			"Lint fixes (js/ts)",
			() => runOxlint(deps.context),
			() => fixOxlint(deps.context, { force: deps.force }),
		);
	}

	if (deps.projectInfo.languages.includes("python") && deps.projectInfo.installedTools.ruff) {
		await deps.runStep(
			"Lint fixes (python)",
			() => runRuffLint(deps.context),
			() => (deps.force ? fixRuffLintForce(deps.resolvedDir) : fixRuffLint(deps.resolvedDir)),
		);
	} else if (deps.projectInfo.languages.includes("python")) {
		log.warn("Python detected but ruff is not installed; skipping Python lint fixes.");
	}
};

export const runDependencyStep = async (deps: PipelineDeps): Promise<void> => {
	if (!deps.config.engines["code-quality"]) return;
	if (!hasJsOrTs(deps.projectInfo)) return;

	await deps.runStep(
		"Unused dependencies",
		() => runKnipDependencyCheck(deps.resolvedDir),
		() => fixUnusedDependencies(deps.resolvedDir),
	);
};

// Phase 2: Formatting (runs last to clean up after all code changes)
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
			() => fixRuffFormat(deps.resolvedDir),
		);
	} else if (deps.projectInfo.languages.includes("python")) {
		log.warn("Python detected but ruff is not installed; skipping Python formatting fixes.");
	}

	if (deps.projectInfo.languages.includes("go") && deps.projectInfo.installedTools.gofmt) {
		await deps.runStep(
			"Formatting (go)",
			() => runGofmt(deps.context),
			() => fixGofmt(deps.resolvedDir),
		);
	} else if (deps.projectInfo.languages.includes("go")) {
		log.warn("Go detected but gofmt is not installed; skipping Go formatting fixes.");
	}
};

export const runForceSteps = async (deps: PipelineDeps): Promise<void> => {
	if (!deps.force) return;

	if (deps.config.engines["code-quality"] && hasJsOrTs(deps.projectInfo)) {
		await deps.runStep(
			"Remove unused files",
			() => runKnipUnusedFiles(deps.resolvedDir),
			() => fixUnusedFiles(deps.resolvedDir),
		);
	}

	if (deps.config.engines.security) {
		await deps.runStep(
			"Dependency audit fixes",
			() => runDependencyAudit(deps.context),
			() => fixDependencyAudit(deps.context),
		);
	}

	if (deps.projectInfo.frameworks.includes("expo")) {
		await deps.runStep(
			"Expo dependency alignment",
			() => runExpoDoctor(deps.context),
			() => fixExpoDependencies(deps.context),
		);
	}
};
