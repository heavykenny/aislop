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
	dependencies?: KnipIssueItem[];
	devDependencies?: KnipIssueItem[];
	unlisted?: KnipIssueItem[];
	unresolved?: KnipIssueItem[];
	binaries?: KnipIssueItem[];
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
	dependencies: "Unused dependency",
	devDependencies: "Unused devDependency",
	unlisted: "Unlisted dependency",
	unresolved: "Unresolved import",
	binaries: "Unlisted binary",
	exports: "Unused export",
	types: "Unused type",
	duplicates: "Duplicate export",
};

const DEPENDENCY_TYPES = [
	"dependencies",
	"devDependencies",
	"unlisted",
	"unresolved",
	"binaries",
] as const;

const isDependencyType = (type: string): type is (typeof DEPENDENCY_TYPES)[number] =>
	(DEPENDENCY_TYPES as readonly string[]).includes(type);

const getIssueItems = (fileIssue: KnipFileIssue, issueType: string): KnipIssueItem[] => {
	const items = fileIssue[issueType as keyof KnipFileIssue];
	return Array.isArray(items) ? items : [];
};

// Runner-provided binaries (gh, aws, docker) can't be listed in package.json.
export const shouldIncludeIssue = (issueType: string, filePath: string): boolean => {
	if (issueType !== "binaries") return true;
	const normalized = filePath.replace(/\\/g, "/");
	return !normalized.includes(".github/workflows/");
};

const DEPENDENCY_HELP: Record<string, string> = {
	dependencies:
		"This package is listed in package.json but not imported anywhere. Remove it with `npm uninstall` or `npx aislop fix`.",
	devDependencies:
		"This package is listed in package.json but not imported anywhere. Remove it with `npm uninstall` or `npx aislop fix`.",
	unlisted:
		"This package is imported in code but not declared in package.json. Run `npm install` to add it.",
	unresolved: "This import cannot be resolved. Check for typos or missing packages.",
	binaries: "This binary is used but its package is not in package.json.",
};

const collectIssues = (
	fileIssue: KnipFileIssue,
	issueType: string,
	rootDir: string,
	knipCwd: string,
): Diagnostic[] => {
	const diagnostics: Diagnostic[] = [];
	if (!shouldIncludeIssue(issueType, fileIssue.file)) return diagnostics;
	const issues = getIssueItems(fileIssue, issueType);
	const isDepType = isDependencyType(issueType);
	const category = isDepType ? "Dependencies" : "Dead Code";
	const severity = issueType === "unlisted" || issueType === "unresolved" ? "error" : "warning";
	const fixable =
		issueType === "dependencies" ||
		issueType === "devDependencies" ||
		issueType === "exports" ||
		issueType === "types" ||
		issueType === "duplicates";
	const help = DEPENDENCY_HELP[issueType] ?? "";

	for (const issue of issues) {
		const symbol = issue.name ?? issue.symbol ?? "unknown";
		const absolutePath = path.resolve(knipCwd, fileIssue.file);
		diagnostics.push({
			filePath: path.relative(rootDir, absolutePath),
			engine: "code-quality",
			rule: `knip/${issueType}`,
			severity,
			message: `${KNIP_MESSAGE_MAP[issueType]}: ${symbol}`,
			help,
			line: issue.line ?? 0,
			column: issue.col ?? 0,
			category,
			fixable,
		});
	}

	return diagnostics;
};

const findMonorepoRoot = (directory: string): string | null => {
	let current = directory;
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

export const runKnipDependencyCheck = async (rootDirectory: string): Promise<Diagnostic[]> => {
	const all = await runKnip(rootDirectory);
	return all.filter((d) => d.rule === "knip/dependencies" || d.rule === "knip/devDependencies");
};

export const fixUnusedDependencies = async (rootDirectory: string): Promise<void> => {
	const diagnostics = await runKnipDependencyCheck(rootDirectory);
	if (diagnostics.length === 0) return;

	const pkgPath = path.join(rootDirectory, "package.json");
	if (!fs.existsSync(pkgPath)) return;

	const raw = fs.readFileSync(pkgPath, "utf-8");
	const pkg = JSON.parse(raw) as Record<string, Record<string, string>>;

	const unusedDeps = new Set<string>();
	const unusedDevDeps = new Set<string>();

	for (const d of diagnostics) {
		const pkgName = d.message.replace(/^Unused (dev)?[Dd]ependency: /, "");
		if (d.rule === "knip/dependencies") unusedDeps.add(pkgName);
		if (d.rule === "knip/devDependencies") unusedDevDeps.add(pkgName);
	}

	let changed = false;

	if (pkg.dependencies) {
		for (const name of unusedDeps) {
			if (name in pkg.dependencies) {
				delete pkg.dependencies[name];
				changed = true;
			}
		}
	}

	if (pkg.devDependencies) {
		for (const name of unusedDevDeps) {
			if (name in pkg.devDependencies) {
				delete pkg.devDependencies[name];
				changed = true;
			}
		}
	}

	if (changed) {
		fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);
	}
};

export const runKnipUnusedFiles = async (rootDirectory: string): Promise<Diagnostic[]> => {
	const all = await runKnip(rootDirectory);
	return all.filter((d) => d.rule === "knip/files");
};

export const fixUnusedFiles = async (rootDirectory: string): Promise<void> => {
	const diagnostics = await runKnipUnusedFiles(rootDirectory);
	for (const d of diagnostics) {
		const absolutePath = path.resolve(rootDirectory, d.filePath);
		if (fs.existsSync(absolutePath)) {
			fs.unlinkSync(absolutePath);
		}
	}
};

export const runKnip = async (rootDirectory: string): Promise<Diagnostic[]> => {
	const monorepoRoot = findMonorepoRoot(rootDirectory);
	const knipRuntime = findKnipBin(rootDirectory, monorepoRoot);
	if (!knipRuntime) return [];

	try {
		const args = [knipRuntime.binPath, "--no-progress", "--reporter", "json", "--no-exit-code"];
		const result = await runSubprocess(process.execPath, args, {
			cwd: knipRuntime.cwd,
			timeout: 60000,
			env: { FORCE_COLOR: "0" },
		});
		if (!result.stdout) return [];
		const parsed = JSON.parse(result.stdout) as KnipJsonOutput;

		const diagnostics: Diagnostic[] = [];
		const files = parsed.files ?? [];
		for (const unusedFile of files) {
			diagnostics.push({
				filePath: path.relative(rootDirectory, path.resolve(knipRuntime.cwd, unusedFile)),
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
		const issueTypes = [...DEPENDENCY_TYPES, "exports", "types", "duplicates"] as const;
		for (const fileIssue of issues) {
			for (const type of issueTypes) {
				diagnostics.push(...collectIssues(fileIssue, type, rootDirectory, knipRuntime.cwd));
			}
		}

		return diagnostics;
	} catch {
		return [];
	}
};
