import fs from "node:fs";
import path from "node:path";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic } from "../types.js";

interface KnipIssueItem {
	name?: string;
	line?: number;
	col?: number;
	symbol?: string;
}

interface KnipFileIssue {
	file: string;
	exports?: KnipIssueItem[];
	types?: KnipIssueItem[];
	duplicates?: KnipIssueItem[];
}

interface KnipJsonOutput {
	files?: string[];
	issues?: KnipFileIssue[];
}

const KNIP_MESSAGE_MAP: Record<string, string> = {
	files: "Unused file",
	exports: "Unused export",
	types: "Unused type",
	duplicates: "Duplicate export",
};

const collectIssues = (
	fileIssue: KnipFileIssue,
	issueType: string,
	rootDir: string,
	knipCwd: string,
): Diagnostic[] => {
	const diagnostics: Diagnostic[] = [];
	const issues =
		issueType === "exports"
			? (fileIssue.exports ?? [])
			: issueType === "types"
				? (fileIssue.types ?? [])
				: (fileIssue.duplicates ?? []);

	for (const issue of issues) {
		const symbol = issue.name ?? issue.symbol ?? "unknown";
		const absolutePath = path.resolve(knipCwd, fileIssue.file);
		diagnostics.push({
			filePath: path.relative(rootDir, absolutePath),
			engine: "code-quality",
			rule: `knip/${issueType}`,
			severity: "warning",
			message: `${KNIP_MESSAGE_MAP[issueType]}: ${symbol}`,
			help: "",
			line: issue.line ?? 0,
			column: issue.col ?? 0,
			category: "Dead Code",
			fixable: false,
		});
	}

	return diagnostics;
};

const findMonorepoRoot = (directory: string): string | null => {
	let current = path.dirname(directory);
	while (current !== path.dirname(current)) {
		if (
			fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
			(() => {
				const pkgPath = path.join(current, "package.json");
				if (!fs.existsSync(pkgPath)) return false;
				const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
				return Array.isArray(pkg.workspaces) || pkg.workspaces?.packages;
			})()
		) {
			return current;
		}
		current = path.dirname(current);
	}
	return null;
};

const KNIP_RELATIVE_BIN = path.join("node_modules", "knip", "bin", "knip.js");

const findKnipBin = (
	rootDirectory: string,
	monorepoRoot: string | null,
): { binPath: string; cwd: string } | null => {
	const localPath = path.join(rootDirectory, KNIP_RELATIVE_BIN);
	if (fs.existsSync(localPath)) {
		return { binPath: localPath, cwd: rootDirectory };
	}

	if (monorepoRoot) {
		const monorepoPath = path.join(monorepoRoot, KNIP_RELATIVE_BIN);
		if (fs.existsSync(monorepoPath)) {
			return { binPath: monorepoPath, cwd: monorepoRoot };
		}
	}

	return null;
};

export const runKnip = async (rootDirectory: string): Promise<Diagnostic[]> => {
	const monorepoRoot = findMonorepoRoot(rootDirectory);
	const knipRuntime = findKnipBin(rootDirectory, monorepoRoot);
	if (!knipRuntime) return [];

	try {
		const args = [
			knipRuntime.binPath,
			"--no-progress",
			"--reporter",
			"json",
			"--no-exit-code",
		];
		const result = await runSubprocess(process.execPath, args, {
			cwd: knipRuntime.cwd,
			timeout: 20000,
			env: { FORCE_COLOR: "0" },
		});
		if (!result.stdout) return [];
		const parsed = JSON.parse(result.stdout) as KnipJsonOutput;

		const diagnostics: Diagnostic[] = [];
		const files = parsed.files ?? [];
		for (const unusedFile of files) {
			diagnostics.push({
				filePath: path.relative(
					rootDirectory,
					path.resolve(knipRuntime.cwd, unusedFile),
				),
				engine: "code-quality",
				rule: "knip/files",
				severity: "warning",
				message: KNIP_MESSAGE_MAP.files,
				help: "This file is not imported by any other file in the project.",
				line: 0,
				column: 0,
				category: "Dead Code",
				fixable: false,
			});
		}

		const issues = parsed.issues ?? [];
		for (const fileIssue of issues) {
			for (const type of ["exports", "types", "duplicates"] as const) {
				diagnostics.push(
					...collectIssues(fileIssue, type, rootDirectory, knipRuntime.cwd),
				);
			}
		}

		return diagnostics;
	} catch {
		return [];
	}
};
