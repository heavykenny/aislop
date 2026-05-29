import path from "node:path";
import { buildHookScanCompletedProps, track } from "../../telemetry/index.js";
import { type AislopFeedback, buildFeedback } from "../feedback.js";
import { acquireHookLock } from "../io/scan-lock.js";
import { resolveHookFiles, runScopedScan } from "../io/scoped-scan.js";
import { appendSessionFiles, readBaseline } from "../quality-gate/baseline.js";

interface PiHookStdin {
	cwd?: string;
	file_path?: string;
	tool_name?: string;
}

interface PiHookOutput {
	schema: "aislop.hook.v2";
	block: boolean;
	message: string;
	feedback: AislopFeedback;
}

export const parsePiStdin = (raw: string): PiHookStdin => {
	if (!raw.trim()) return {};
	try {
		return JSON.parse(raw) as PiHookStdin;
	} catch {
		return {};
	}
};

const readStdin = async (): Promise<string> => {
	if (process.stdin.isTTY) return "";
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf-8");
};

export const formatPiMessage = (feedback: AislopFeedback): string => {
	if (feedback.counts.total === 0 && !feedback.regressed) return "";

	const { error, warning } = feedback.counts;
	const header =
		`aislop: score ${feedback.score}/100` +
		`${feedback.baseline != null ? ` (baseline ${feedback.baseline})` : ""}, ` +
		`${error} error${error === 1 ? "" : "s"}, ${warning} warning${warning === 1 ? "" : "s"}.`;

	const lines = feedback.findings.map(
		(f) => `  - ${f.file}:${f.line} [${f.severity}] ${f.ruleId}: ${f.message}`,
	);
	if (feedback.elided && feedback.elided > 0) {
		lines.push(`  ...and ${feedback.elided} more.`);
	}

	const tail = feedback.nextSteps.length > 0 ? `\n${feedback.nextSteps.join("\n")}` : "";
	return `${header}\n${lines.join("\n")}${tail}`;
};

export const runPiHook = async (
	deps: { stdin?: () => Promise<string>; write?: (s: string) => void } = {},
): Promise<number> => {
	const getStdin = deps.stdin ?? readStdin;
	const write = deps.write ?? ((s: string) => process.stdout.write(s));

	const raw = await getStdin();
	const input = parsePiStdin(raw);
	const cwd = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd();
	const files = resolveHookFiles(cwd, input.file_path ? [input.file_path] : []);

	if (files.length === 0) return 0;
	const release = acquireHookLock(cwd);
	if (!release) return 0;

	try {
		const { diagnostics, score, rootDirectory } = await runScopedScan(cwd, files);
		const baseline = readBaseline(cwd);
		appendSessionFiles(cwd, files);
		const feedback = buildFeedback(
			diagnostics,
			score,
			rootDirectory,
			baseline
				? { score: baseline.score, findingFingerprints: baseline.findingFingerprints }
				: undefined,
			{ agent: "pi", touchedFiles: files },
		);
		track({
			event: "hook_scan_completed",
			properties: buildHookScanCompletedProps({
				agent: "pi",
				score,
				scoreDelta: baseline ? score - baseline.score : null,
				findingCount: diagnostics.length,
				fileCount: files.length,
			}),
		});
		const output: PiHookOutput = {
			schema: "aislop.hook.v2",
			block: feedback.counts.error > 0 || feedback.regressed,
			message: formatPiMessage(feedback),
			feedback,
		};
		write(JSON.stringify(output));
		return 0;
	} catch {
		// A hook crash must never break the user's pi edit.
		return 0;
	} finally {
		release();
	}
};
