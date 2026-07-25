import type { ScanScopeMode } from "./scan-file-scope.js";

export interface ScanOptions {
	changes: boolean;
	staged: boolean;
	base?: string;
	verbose: boolean;
	json: boolean;
	sarif?: boolean;
	showHeader?: boolean;
	printBrand?: boolean;
	exclude?: string[];
	include?: string[];
	/** Used for telemetry to distinguish scan vs ci invocation */
	command?: "scan" | "ci";
}

// SARIF and JSON are machine outputs: suppress all human chrome on stdout.
export const isMachineOutput = (options: ScanOptions): boolean =>
	Boolean(options.json) || Boolean(options.sarif);

export const isHistoryComparableScan = (options: ScanOptions): boolean =>
	!options.staged && !options.changes && options.command !== "ci";

export const isFullProjectScan = (options: ScanOptions): boolean =>
	isHistoryComparableScan(options) && !options.include?.length && !options.exclude?.length;

export const resolveScanScopeMode = (options: ScanOptions): ScanScopeMode => {
	if (options.staged) return { kind: "staged" };
	if (options.changes) {
		return options.base ? { kind: "changes", base: options.base } : { kind: "changes" };
	}
	return { kind: "full" };
};
