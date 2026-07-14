import path from "node:path";
import type { Diagnostic } from "../engines/types.js";
import { toPosix } from "../utils/paths.js";

interface FindingFix {
	kind: "replace" | "delete-line" | "delete-range" | "insert";
	old?: string;
	new?: string;
	range?: { startLine: number; endLine: number };
}

interface Finding {
	ruleId: string;
	severity: "error" | "warning";
	category: Diagnostic["category"];
	file: string;
	line: number;
	col?: number;
	message: string;
	fix?: FindingFix;
}

type SuggestedActionId = "run_aislop_fix" | "run_aislop_fix_force" | "review_finding" | "no_action";

interface SuggestedAction {
	id: SuggestedActionId;
	label: string;
	command?: string;
	rationale: string;
	ruleIds?: string[];
}

export interface AislopFeedback {
	schema: "aislop.hook.v2";
	score: number;
	baseline?: number;
	delta?: number;
	regressed: boolean;
	accountability?: Accountability;
	counts: {
		error: number;
		warning: number;
		fixable: number;
		total: number;
	};
	findings: Finding[];
	elided?: number;
	newSinceBaseline?: Finding[];
	nextSteps: string[];
	suggestedActions: SuggestedAction[];
}

interface BaselineSnapshot {
	score: number;
	findingFingerprints: string[];
}

type AgentName = "claude" | "cursor" | "gemini" | "pi";

interface FeedbackMeta {
	agent?: AgentName;
	touchedFiles?: string[];
}

interface Accountability {
	agent?: AgentName;
	touchedFiles: string[];
	newFindingCount: number;
	mustFixBeforeDone: boolean;
	reason: string;
}

const fingerprintFinding = (f: Finding): string => `${f.file}:${f.line}:${f.ruleId}`;

const MAX_FINDINGS = 20;
const MAX_NEW_SINCE_BASELINE = 10;
const REVIEW_TOP_N = 3;
const REGRESSION_FLAG_THRESHOLD = 5;

const toFinding = (d: Diagnostic, rootDirectory: string): Finding | null => {
	if (d.severity !== "error" && d.severity !== "warning") return null;
	const file = toPosix(
		path.isAbsolute(d.filePath) ? path.relative(rootDirectory, d.filePath) : d.filePath,
	);
	return {
		ruleId: d.rule,
		severity: d.severity,
		category: d.category,
		file,
		line: d.line,
		col: d.column || undefined,
		message: d.message,
	};
};

const buildNextSteps = (findings: Finding[]): string[] => {
	const steps: string[] = [];
	const errorCount = findings.filter((f) => f.severity === "error").length;
	if (errorCount > 0) {
		steps.push(`Fix ${errorCount} error${errorCount === 1 ? "" : "s"} before the next turn.`);
	}
	const byFile = new Map<string, Finding[]>();
	for (const f of findings) {
		const list = byFile.get(f.file) ?? [];
		list.push(f);
		byFile.set(f.file, list);
	}
	for (const [file, list] of Array.from(byFile.entries()).slice(0, 3)) {
		const lines = list
			.map((f) => f.line)
			.slice(0, 3)
			.join(", ");
		steps.push(
			`Address ${list.length} finding${list.length === 1 ? "" : "s"} in ${file} (line${list.length === 1 ? "" : "s"} ${lines}).`,
		);
	}
	return steps;
};

const buildSuggestedActions = (
	diagnostics: Diagnostic[],
	findings: Finding[],
	regressed: boolean,
	delta: number | undefined,
): SuggestedAction[] => {
	const actions: SuggestedAction[] = [];

	const fixableDiags = diagnostics.filter((d) => d.fixable);
	if (fixableDiags.length > 0) {
		const ruleIds = Array.from(new Set(fixableDiags.map((d) => d.rule)));
		actions.push({
			id: "run_aislop_fix",
			label: `Run aislop fix to clear ${fixableDiags.length} mechanical finding${fixableDiags.length === 1 ? "" : "s"}.`,
			command: "aislop fix",
			rationale:
				"These findings have deterministic fixes (formatting, unused imports, trivial comments). Running this before any manual work avoids burning agent tokens on what the CLI handles for free.",
			ruleIds,
		});
	}

	const archErrors = findings.filter((f) => f.ruleId.startsWith("arch/") && f.severity === "error");
	if (archErrors.length > 0) {
		actions.push({
			id: "review_finding",
			label: `Review ${archErrors.length} architecture rule violation${archErrors.length === 1 ? "" : "s"} — these can't be auto-fixed.`,
			rationale:
				"Architecture rules encode intentional project structure decisions. The fix usually means moving code, not editing it.",
			ruleIds: Array.from(new Set(archErrors.map((f) => f.ruleId))),
		});
	}

	const significantRegression =
		regressed && typeof delta === "number" && delta <= -REGRESSION_FLAG_THRESHOLD;
	if (significantRegression && fixableDiags.length === 0) {
		const top = findings
			.filter((f) => f.severity === "error" || f.severity === "warning")
			.slice(0, REVIEW_TOP_N);
		if (top.length > 0) {
			actions.push({
				id: "review_finding",
				label: `Score dropped ${Math.abs(delta as number)} points — review the top ${top.length} finding${top.length === 1 ? "" : "s"} from this edit.`,
				rationale:
					"None of these are auto-fixable. Read each one against the source and decide whether the fix is to change the code or to add a justified suppression with a reason.",
				ruleIds: top.map((f) => f.ruleId),
			});
		}
	}

	if (actions.length === 0) {
		actions.push({
			id: "no_action",
			label:
				typeof delta === "number"
					? delta > 0
						? `Score improved by ${delta}. No action needed.`
						: "Score unchanged. No action needed."
					: "No findings. No action needed.",
			rationale: "The current scan didn't reveal anything that requires the agent's attention.",
		});
	}

	return actions;
};

const buildAccountability = (
	meta: FeedbackMeta | undefined,
	findings: Finding[],
	regressed: boolean,
	newSinceBaseline: Finding[] | undefined,
): Accountability | undefined => {
	if (!meta?.agent && (!meta?.touchedFiles || meta.touchedFiles.length === 0)) return undefined;

	const touchedFiles = Array.from(new Set(meta.touchedFiles ?? []));
	const newFindingCount = newSinceBaseline?.length ?? findings.length;
	const mustFixBeforeDone = regressed || findings.some((f) => f.severity === "error");
	const reason = mustFixBeforeDone
		? regressed
			? "Score regressed against the captured baseline. The agent should fix or justify the new findings before finishing."
			: "Error-severity findings remain in files touched by this agent turn."
		: "No blocking regression detected for this agent turn.";

	return {
		agent: meta.agent,
		touchedFiles,
		newFindingCount,
		mustFixBeforeDone,
		reason,
	};
};

export const buildFeedback = (
	diagnostics: Diagnostic[],
	score: number,
	rootDirectory: string,
	baseline?: BaselineSnapshot | number,
	meta?: FeedbackMeta,
): AislopFeedback => {
	const all = diagnostics
		.map((d) => toFinding(d, rootDirectory))
		.filter((x): x is Finding => x !== null);
	const capped = all.slice(0, MAX_FINDINGS);
	const elided = all.length > MAX_FINDINGS ? all.length - MAX_FINDINGS : undefined;

	const counts = {
		error: diagnostics.filter((d) => d.severity === "error").length,
		warning: diagnostics.filter((d) => d.severity === "warning").length,
		fixable: diagnostics.filter((d) => d.fixable).length,
		total: all.length,
	};

	const baselineSnapshot: BaselineSnapshot | undefined =
		typeof baseline === "number" ? { score: baseline, findingFingerprints: [] } : baseline;

	const baselineScore = baselineSnapshot?.score;
	const delta = typeof baselineScore === "number" ? score - baselineScore : undefined;
	const regressed = typeof delta === "number" ? delta < 0 : false;

	let newSinceBaseline: Finding[] | undefined;
	if (baselineSnapshot && baselineSnapshot.findingFingerprints.length > 0) {
		const known = new Set(baselineSnapshot.findingFingerprints);
		const fresh = all.filter((f) => !known.has(fingerprintFinding(f)));
		newSinceBaseline = fresh.slice(0, MAX_NEW_SINCE_BASELINE);
	}

	return {
		schema: "aislop.hook.v2",
		score,
		baseline: baselineScore,
		delta,
		regressed,
		accountability: buildAccountability(meta, capped, regressed, newSinceBaseline),
		counts,
		findings: capped,
		elided,
		newSinceBaseline,
		nextSteps: buildNextSteps(capped),
		suggestedActions: buildSuggestedActions(diagnostics, capped, regressed, delta),
	};
};
