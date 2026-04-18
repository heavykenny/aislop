import { performance } from "node:perf_hooks";
import type { Diagnostic } from "../engines/types.js";
import type { RailStep } from "../ui/rail.js";

export interface FixStepResult {
	name: string;
	beforeIssues: number;
	afterIssues: number;
	resolvedIssues: number;
	beforeFiles: number;
	failed: boolean;
	elapsedMs: number;
}

const uniqueFileCount = (diagnostics: Diagnostic[]): number =>
	new Set(diagnostics.map((d) => d.filePath)).size;

export const runOneFixStep = async (
	name: string,
	detect: () => Promise<Diagnostic[]>,
	applyFix: () => Promise<void>,
): Promise<FixStepResult> => {
	const started = performance.now();
	const before = await detect();
	let applyError: unknown = null;
	if (before.length > 0) {
		try {
			await applyFix();
		} catch (error) {
			applyError = error;
		}
	}
	const after = before.length > 0 ? await detect() : before;
	return {
		name,
		beforeIssues: before.length,
		afterIssues: after.length,
		resolvedIssues: Math.max(0, before.length - after.length),
		beforeFiles: uniqueFileCount(before),
		failed: applyError !== null && before.length === after.length,
		elapsedMs: performance.now() - started,
	};
};

export const describeStep = (result: FixStepResult): string => {
	if (result.failed) {
		return `${result.name} — failed (${result.afterIssues} remain)`;
	}
	if (result.beforeIssues === 0) {
		return `${result.name} — 0 issues`;
	}
	if (result.afterIssues === 0) {
		return `${result.name} — ${result.resolvedIssues} resolved`;
	}
	if (result.resolvedIssues > 0) {
		return `${result.name} — ${result.resolvedIssues} resolved, ${result.afterIssues} remaining`;
	}
	return `${result.name} — ${result.afterIssues} remain`;
};

export const statusFor = (s: FixStepResult): RailStep["status"] => {
	if (s.failed) return "failed";
	if (s.afterIssues > 0) return "warn";
	return "done";
};
