import type { AislopConfig } from "../config/index.js";
import { detectTrivialComments } from "../engines/ai-slop/comments.js";
import { detectDeadPatterns } from "../engines/ai-slop/dead-patterns.js";
import { fixDeadPatterns } from "../engines/ai-slop/dead-patterns-fix.js";
import { detectDuplicateImports } from "../engines/ai-slop/duplicate-imports.js";
import { fixDuplicateImports } from "../engines/ai-slop/duplicate-imports-fix.js";
import { detectNarrativeComments } from "../engines/ai-slop/narrative-comments.js";
import { fixNarrativeComments } from "../engines/ai-slop/narrative-comments-fix.js";
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
import { runExpoDoctor } from "../engines/lint/expo-doctor.js";
import { fixRubyLint, runGenericLinter } from "../engines/lint/generic.js";
import { fixOxlint, runOxlint } from "../engines/lint/oxlint.js";
import { fixRuffLint, fixRuffLintForce, runRuffLint } from "../engines/lint/ruff.js";
import { runDependencyAudit } from "../engines/security/audit.js";
import type { Diagnostic, EngineContext } from "../engines/types.js";
import { log } from "../ui/logger.js";
import type { discoverProject } from "../utils/discover.js";
import { fixExpoDependencies } from "./fix-expo.js";
import { fixDependencyAudit } from "./fix-force.js";
import { hasJsOrTs } from "./fix-pipeline-language.js";
import type { FixStepResult } from "./fix-steps.js";

export { runFormattingStep } from "./fix-formatting-pipeline.js";

export type ProjectInfo = Awaited<ReturnType<typeof discoverProject>>;

type RunStepFn = (
	name: string,
	detect: () => Promise<Diagnostic[]>,
	applyFix: () => Promise<void>,
) => Promise<FixStepResult>;

export interface PipelineDeps {
	rail: {
		start: (name: string) => void;
		setActiveLabel: (label: string) => void;
	};
	context: EngineContext;
	config: AislopConfig;
	resolvedDir: string;
	projectInfo: ProjectInfo;
	force: boolean;
	// Restrict to reversible fixes only (imports, comment removal, safe formatter runs).
	safe: boolean;
	runStep: RunStepFn;
}

export const runAiSlopSteps = async (deps: PipelineDeps): Promise<void> => {
	if (!deps.config.engines["ai-slop"]) return;

	await deps.runStep(
		"Unused imports",
		() => detectUnusedImports(deps.context),
		() => fixUnusedImports(deps.context),
	);

	await deps.runStep(
		"Duplicate imports",
		() => detectDuplicateImports(deps.context),
		() => fixDuplicateImports(deps.context),
	);

	// Dead-pattern removal deletes code (console statements, dead branches), so in
	// safe mode we keep only narrative-comment removal, which is reversible.
	if (deps.safe) {
		await deps.runStep(
			"Narrative comments",
			async () => (await detectNarrativeComments(deps.context)).filter((d) => d.fixable),
			() => fixNarrativeComments(deps.context),
		);
		return;
	}

	const detectFixableSlop = async () => {
		const [comments, dead, narrative] = await Promise.all([
			detectTrivialComments(deps.context),
			detectDeadPatterns(deps.context),
			detectNarrativeComments(deps.context),
		]);
		return [...comments, ...dead, ...narrative].filter((d) => d.fixable);
	};

	await deps.runStep("Dead code & comments", detectFixableSlop, async () => {
		await fixDeadPatterns(deps.context);
		await fixNarrativeComments(deps.context);
	});
};

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

	if (deps.projectInfo.languages.includes("ruby") && deps.projectInfo.installedTools.rubocop) {
		await deps.runStep(
			"Lint fixes (ruby)",
			() => runGenericLinter(deps.context, "ruby"),
			() => fixRubyLint(deps.resolvedDir),
		);
	} else if (deps.projectInfo.languages.includes("ruby")) {
		log.warn("Ruby detected but rubocop is not installed; skipping Ruby lint fixes.");
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

export const runForceSteps = async (deps: PipelineDeps): Promise<void> => {
	if (!deps.force) return;

	if (deps.config.engines["code-quality"] && hasJsOrTs(deps.projectInfo)) {
		await deps.runStep(
			"Remove unused files",
			() => runKnipUnusedFiles(deps.resolvedDir),
			() => fixUnusedFiles(deps.resolvedDir),
		);
	}

	const railUpdate = (label: string) => deps.rail.setActiveLabel(label);

	if (deps.config.engines.security) {
		await deps.runStep(
			"Dependency audit fixes",
			() => runDependencyAudit(deps.context),
			() => fixDependencyAudit(deps.context, railUpdate),
		);
	}

	if (deps.projectInfo.frameworks.includes("expo") && deps.config.lint.expoDoctor) {
		await deps.runStep(
			"Expo dependency alignment",
			() => runExpoDoctor(deps.context),
			() => fixExpoDependencies(deps.context, railUpdate),
		);
	}
};
