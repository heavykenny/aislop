import fs from "node:fs";
import type { Diagnostic } from "../engines/types.js";
import type { ScoreResult } from "../scoring/index.js";

const SEV_BADGE: Record<string, string> = {
	error: "🔴 error",
	warning: "🟡 warning",
	info: "🔵 info",
};

const escapeMd = (s: string): string => s.replace(/\|/g, "\\|");

export const writeGitHubStepSummary = (
	diagnostics: Diagnostic[],
	score: ScoreResult,
	fileCount: number,
): void => {
	const path = process.env.GITHUB_STEP_SUMMARY;
	if (!path) return;

	const counts = {
		errors: diagnostics.filter((d) => d.severity === "error").length,
		warnings: diagnostics.filter((d) => d.severity === "warning").length,
		fixable: diagnostics.filter((d) => d.fixable).length,
	};

	const lines: string[] = [];
	lines.push(
		`## aislop · ${score.score} / 100 · ${score.label}`,
		"",
		`**${fileCount} files** · **${counts.errors} errors** · **${counts.warnings} warnings** · **${counts.fixable} auto-fixable**`,
		"",
	);

	if (diagnostics.length === 0) {
		lines.push("✓ No findings.", "");
	} else {
		lines.push(
			"| Severity | Rule | Location | Message | How to fix |",
			"| --- | --- | --- | --- | --- |",
		);
		const sorted = [...diagnostics].sort((a, b) => {
			const rank: Record<string, number> = { error: 0, warning: 1, info: 2 };
			return (rank[a.severity] ?? 99) - (rank[b.severity] ?? 99);
		});
		for (const d of sorted.slice(0, 50)) {
			const sev = SEV_BADGE[d.severity] ?? d.severity;
			const loc = d.line > 0 ? `${d.filePath}:${d.line}` : d.filePath;
			const help = d.help ? escapeMd(d.help) : "—";
			lines.push(
				`| ${sev} | \`${d.rule}\` | \`${escapeMd(loc)}\` | ${escapeMd(d.message)} | ${help} |`,
			);
		}
		if (diagnostics.length > 50) {
			lines.push("", `_+${diagnostics.length - 50} more findings — see the full report._`, "");
		}
	}

	try {
		fs.appendFileSync(path, `${lines.join("\n")}\n`, "utf8");
	} catch {
		// Best-effort: never fail the run because the summary couldn't be written.
	}
};
