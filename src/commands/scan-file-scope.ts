import type { Coverage } from "../utils/discover.js";
import { getChangedFiles, getStagedFiles } from "../utils/git.js";
import {
	filterEnumeratedProjectFiles,
	filterEnumeratedTestFiles,
	filterProjectDeclarationFiles,
	listProjectFiles,
} from "../utils/source-file-selection.js";

export type ScanScopeMode =
	| { readonly kind: "full" }
	| { readonly kind: "staged" }
	| { readonly base?: string; readonly kind: "changes" };

interface ScanFileScopeRequest {
	readonly excludePatterns: string[];
	readonly includePatterns: string[];
	readonly mode: ScanScopeMode;
	readonly rootDirectory: string;
}

interface ScanFileScope {
	readonly files: string[];
	readonly projectFiles: string[];
	readonly scoreFileCount: number;
	readonly scopeLabel: string;
	readonly testFiles: string[];
}

export const deriveScanCoverage = (coverage: Coverage, fileCount: number): Coverage => ({
	...coverage,
	supportedFiles: fileCount,
	scoreable: !(
		fileCount === 0 ||
		(coverage.unsupportedFiles >= 10 && coverage.unsupportedFiles > fileCount * 3)
	),
});

const scopedCandidates = (
	rootDirectory: string,
	projectCandidates: string[],
	mode: ScanScopeMode,
): { files: string[]; label: string } => {
	switch (mode.kind) {
		case "staged":
			return { files: getStagedFiles(rootDirectory), label: "staged file(s)" };
		case "changes":
			return {
				files: getChangedFiles(rootDirectory, mode.base),
				label: mode.base ? `changed vs ${mode.base} file(s)` : "changed file(s)",
			};
		case "full":
			return { files: projectCandidates, label: "file(s) after exclusions" };
		default:
			return mode satisfies never;
	}
};

export const collectScanFileScope = (request: ScanFileScopeRequest): ScanFileScope => {
	const projectCandidates = listProjectFiles(request.rootDirectory);
	const candidates = scopedCandidates(request.rootDirectory, projectCandidates, request.mode);
	const files = filterEnumeratedProjectFiles(
		request.rootDirectory,
		candidates.files,
		[],
		request.excludePatterns,
		request.includePatterns,
	);
	const testFiles = filterEnumeratedTestFiles(
		request.rootDirectory,
		candidates.files,
		request.excludePatterns,
		request.includePatterns,
	);
	const projectSourceFiles = filterEnumeratedProjectFiles(
		request.rootDirectory,
		projectCandidates,
		[],
		request.excludePatterns,
		request.includePatterns,
	);
	const projectTestFiles = filterEnumeratedTestFiles(
		request.rootDirectory,
		projectCandidates,
		request.excludePatterns,
		request.includePatterns,
	);
	const declarations = filterProjectDeclarationFiles(
		request.rootDirectory,
		projectCandidates,
		request.excludePatterns,
		request.includePatterns,
	);
	return {
		files,
		projectFiles: [...new Set([...projectSourceFiles, ...declarations])],
		scoreFileCount: projectSourceFiles.length + projectTestFiles.length,
		scopeLabel: candidates.label,
		testFiles,
	};
};
