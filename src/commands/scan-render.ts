import type { Diagnostic, EngineResult } from "../engines/types.js";
import { summarizeFindingAssessments } from "../output/finding-assessment.js";
import { renderDiagnostics } from "../output/terminal.js";
import { renderHeader } from "../ui/header.js";
import { detectInvocation } from "../ui/invocation.js";
import {
	type BreakdownSummary,
	type NextStep,
	renderCleanRun,
	renderStarCta,
	renderSummary,
} from "../ui/summary.js";
import { createSymbols } from "../ui/symbols.js";
import { createTheme } from "../ui/theme.js";
import { APP_VERSION } from "../version.js";

const BREAKDOWN_TOP_N = 10;

const computeBreakdown = (diagnostics: Diagnostic[]): BreakdownSummary => {
	const byRule = new Map<
		string,
		{ rule: string; errors: number; warnings: number; info: number; fixable: number }
	>();
	for (const d of diagnostics) {
		const row = byRule.get(d.rule) ?? {
			rule: d.rule,
			errors: 0,
			warnings: 0,
			info: 0,
			fixable: 0,
		};
		if (d.severity === "error") row.errors++;
		else if (d.severity === "warning") row.warnings++;
		else row.info++;
		if (d.fixable) row.fixable++;
		byRule.set(d.rule, row);
	}
	const sorted = [...byRule.values()].sort((a, b) => {
		const aTotal = a.errors + a.warnings + a.info;
		const bTotal = b.errors + b.warnings + b.info;
		if (aTotal !== bTotal) return bTotal - aTotal;
		if (a.errors !== b.errors) return b.errors - a.errors;
		return a.rule.localeCompare(b.rule);
	});
	const rows = sorted.slice(0, BREAKDOWN_TOP_N);
	const hidden = sorted.slice(BREAKDOWN_TOP_N);
	return {
		rows,
		hiddenRules: hidden.length,
		hiddenErrors: hidden.reduce((acc, r) => acc + r.errors, 0),
		hiddenWarnings: hidden.reduce((acc, r) => acc + r.warnings, 0),
	};
};

interface BuildScanRenderInput {
	projectName: string;
	language: string;
	fileCount: number;
	results: EngineResult[];
	diagnostics: Diagnostic[];
	score: { score: number; label: string };
	elapsedMs: number;
	thresholds: { good: number; ok: number };
	verbose: boolean;
	includeHeader?: boolean;
	printBrand?: boolean;
}

export const buildScanRender = (input: BuildScanRenderInput): string => {
	const deps = {
		theme: createTheme(),
		symbols: createSymbols({ plain: false }),
	};

	const invocation = detectInvocation();

	const header =
		input.includeHeader === false
			? ""
			: renderHeader(
					{
						version: APP_VERSION,
						command: "Scan result",
						context: [input.projectName, input.language, `${input.fileCount} files`],
						brand: input.printBrand !== false,
					},
					deps,
				);

	const errors = input.diagnostics.filter((d) => d.severity === "error").length;
	const warnings = input.diagnostics.filter((d) => d.severity === "warning").length;
	const fixable = input.diagnostics.filter((d) => d.fixable).length;
	const hasVulnerableDeps = input.diagnostics.some(
		(d) => d.rule === "security/vulnerable-dependency",
	);

	const starCta = input.printBrand !== false ? renderStarCta(deps) : "";

	if (input.diagnostics.length === 0 && input.score.score === 100) {
		return `${header}${renderCleanRun(
			{ score: input.score.score, label: input.score.label, elapsedMs: input.elapsedMs },
			deps,
		)}${starCta}`;
	}

	const diagBlock =
		input.diagnostics.length === 0 ? "" : renderDiagnostics(input.diagnostics, input.verbose);

	const nextSteps: NextStep[] = [];
	if (fixable > 0) {
		nextSteps.push({
			emphasis: "primary",
			text: `Run ${invocation} fix to auto-fix ${fixable} issue${fixable === 1 ? "" : "s"}`,
		});
	}
	if (hasVulnerableDeps) {
		nextSteps.push({
			emphasis: "primary",
			text: `Run ${invocation} fix -f (or --force) to apply aggressive fixes (dependency audit, unused files, framework alignment)`,
		});
	}
	if (errors + warnings > 0) {
		nextSteps.push({
			emphasis: "primary",
			text: `Run ${invocation} fix --claude (or --codex, --cursor, --gemini, etc.) to hand off to agent`,
		});
	}

	const summary = renderSummary(
		{
			score: input.score.score,
			label: input.score.label,
			errors,
			warnings,
			fixable,
			files: input.fileCount,
			engines: input.results.length,
			elapsedMs: input.elapsedMs,
			nextSteps,
			breakdown: computeBreakdown(input.diagnostics),
			findingAssessment: summarizeFindingAssessments(input.diagnostics),
			thresholds: input.thresholds,
		},
		deps,
	);

	return `${header}${diagBlock}${summary}${starCta}`;
};
