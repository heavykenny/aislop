import fs from "node:fs";
import { atomicWrite, readIfExists } from "../io/atomic-write.js";

export type HookScope = "global" | "project";

export interface HookInstallOpts {
	home: string;
	cwd: string;
	scope: HookScope;
	dryRun?: boolean;
	qualityGate?: boolean;
}

export interface HookInstallResult {
	wrote: string[];
	skipped: string[];
	planned: { path: string; summary: string }[];
}

export interface HookUninstallResult {
	removed: string[];
	skipped: string[];
}

export const emptyResult = (): HookInstallResult => ({
	wrote: [],
	skipped: [],
	planned: [],
});

export const applyContent = (
	result: HookInstallResult,
	opts: HookInstallOpts,
	target: string,
	nextContent: string,
	summary: string,
): void => {
	const existing = readIfExists(target);
	if (existing === nextContent) {
		result.skipped.push(target);
		return;
	}
	if (opts.dryRun) {
		result.planned.push({ path: target, summary });
		return;
	}
	atomicWrite(target, nextContent);
	result.wrote.push(target);
};

export const applyRemoval = (
	result: { removed: string[]; skipped: string[] },
	opts: { dryRun?: boolean },
	target: string,
	nextContent: string | null,
): void => {
	const existing = readIfExists(target);
	if (existing == null) {
		result.skipped.push(target);
		return;
	}
	if (existing === (nextContent ?? "")) {
		result.skipped.push(target);
		return;
	}
	if (opts.dryRun) {
		result.removed.push(target);
		return;
	}
	if (nextContent == null) {
		try {
			fs.unlinkSync(target);
		} catch {
			// best-effort
		}
	} else {
		atomicWrite(target, nextContent);
	}
	result.removed.push(target);
};
