import path from "node:path";
import type { Diagnostic } from "../engines/types.js";

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

interface AislopFeedback {
	schema: "aislop.hook.v1";
	score: number;
	baseline?: number;
	regressed: boolean;
	counts: {
		error: number;
		warning: number;
		fixable: number;
		total: number;
	};
	findings: Finding[];
	elided?: number;
	nextSteps: string[];
}

const MAX_FINDINGS = 20;

const toFinding = (d: Diagnostic, rootDirectory: string): Finding | null => {
	if (d.severity !== "error" && d.severity !== "warning") return null;
	const file = path.isAbsolute(d.filePath) ? path.relative(rootDirectory, d.filePath) : d.filePath;
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

export const buildFeedback = (
	diagnostics: Diagnostic[],
	score: number,
	rootDirectory: string,
	baseline?: number,
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

	const regressed = typeof baseline === "number" ? score < baseline : false;

	return {
		schema: "aislop.hook.v1",
		score,
		baseline,
		regressed,
		counts,
		findings: capped,
		elided,
		nextSteps: buildNextSteps(capped),
	};
};
