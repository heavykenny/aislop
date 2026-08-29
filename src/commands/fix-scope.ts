import type { EngineContext } from "../engines/types.js";
import { projectRelativePosix } from "../utils/paths.js";
import { isDependencyAuditInputFile } from "../utils/source-file-selection.js";
import { collectScanFileScope, type ScanFileScope } from "./scan-file-scope.js";
import { resolveScanScopeMode, type ScanOptions } from "./scan-options.js";
import { scanTargetError } from "./scan-validation.js";

export interface FixScopeFlags {
	changes?: boolean;
	staged?: boolean;
	base?: string;
}

export const CANNOT_SCOPE_REASON = "cannot honour an explicit file list under --changes/--staged";

export const MISSING_MANIFEST_REASON = "no manifest or lockfile in the selected scope";

export const fixScopeError = (resolvedDir: string, flags: FixScopeFlags): string | null => {
	if (flags.changes && flags.staged) {
		return "--changes and --staged cannot be used together.";
	}
	const options: ScanOptions = {
		changes: Boolean(flags.changes),
		staged: Boolean(flags.staged),
		base: flags.base,
		verbose: false,
		json: false,
	};
	return scanTargetError(resolvedDir, options);
};

export const collectFixFileScope = (
	rootDirectory: string,
	excludePatterns: string[],
	includePatterns: string[],
	flags: FixScopeFlags,
): ScanFileScope | null => {
	const mode = resolveScanScopeMode({
		changes: Boolean(flags.changes),
		staged: Boolean(flags.staged),
		base: flags.base,
		verbose: false,
		json: false,
	});
	if (mode.kind === "full") return null;
	return collectScanFileScope({
		excludePatterns,
		includePatterns,
		mode,
		rootDirectory,
	});
};

export const isScopedFix = (context: EngineContext): boolean => context.files !== undefined;

export const scopeIncludesDependencyManifest = (context: EngineContext): boolean => {
	if (!isScopedFix(context)) return true;
	const files = context.dependencyAuditFiles ?? context.files ?? [];
	return files.some((filePath) =>
		isDependencyAuditInputFile(projectRelativePosix(context.rootDirectory, filePath)),
	);
};

export const isPathInFixScope = (context: EngineContext, filePath: string): boolean => {
	if (!isScopedFix(context)) return true;
	const relative = projectRelativePosix(context.rootDirectory, filePath);
	const allowed = new Set(
		(context.files ?? []).map((candidate) =>
			projectRelativePosix(context.rootDirectory, candidate),
		),
	);
	return allowed.has(relative);
};
