import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { relativePosix } from "../../utils/paths.js";
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
		"This package is listed in package.json but not imported anywhere. Remove it with `npm uninstall` or `aislop fix`.",
	devDependencies:
		"This package is listed in package.json but not imported anywhere. Remove it with `npm uninstall` or `aislop fix`.",
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
			filePath: relativePosix(rootDir, absolutePath),
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

const isSubpath = (parent: string, child: string): boolean => {
	const relative = path.relative(parent, child);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export const getRelativePathWithinRoot = (
	rootDirectory: string,
	baseDirectory: string,
	reportedPath: string,
): string | null => {
	const rootPath = path.resolve(rootDirectory);
	const absolutePath = path.resolve(baseDirectory, reportedPath);
	if (!isSubpath(rootPath, absolutePath)) return null;
	return relativePosix(rootPath, absolutePath);
};

export const getSafeUnusedFilePath = (rootDirectory: string, filePath: string): string | null => {
	const rootPath = fs.realpathSync(rootDirectory);
	const absolutePath = path.resolve(rootDirectory, filePath);

	let stat: fs.Stats;
	let realPath: string;
	try {
		stat = fs.lstatSync(absolutePath);
		realPath = fs.realpathSync(absolutePath);
	} catch {
		return null;
	}

	if (!stat.isFile()) return null;
	if (!isSubpath(rootPath, realPath)) return null;
	return absolutePath;
};

const KNIP_BIN = path.join("bin", "knip.js");
const requireFromAislop = createRequire(import.meta.url);

const findPackageRoot = (entryPath: string, packageName: string): string | null => {
	let current = path.dirname(entryPath);
	while (current !== path.dirname(current)) {
		const pkgPath = path.join(current, "package.json");
		if (fs.existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
				if (pkg.name === packageName) return current;
			} catch {
				return null;
			}
		}
		current = path.dirname(current);
	}
	return null;
};

const findBundledKnipBin = (): string | null => {
	try {
		const knipEntry = requireFromAislop.resolve("knip");
		const knipRoot = findPackageRoot(knipEntry, "knip");
		if (!knipRoot) return null;

		const binPath = path.join(knipRoot, KNIP_BIN);
		return fs.existsSync(binPath) ? binPath : null;
	} catch {
		return null;
	}
};

const packageDeclaresKnip = (directory: string): boolean => {
	const pkgPath = path.join(directory, "package.json");
	if (!fs.existsSync(pkgPath)) return false;

	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
		return Boolean(
			pkg.dependencies?.knip ||
				pkg.devDependencies?.knip ||
				pkg.peerDependencies?.knip ||
				pkg.optionalDependencies?.knip,
		);
	} catch {
		return false;
	}
};

export const findKnipRuntime = (
	rootDirectory: string,
	monorepoRoot: string | null,
): { binPath: string; cwd: string } | null => {
	const monorepoDeclaresKnip = monorepoRoot ? packageDeclaresKnip(monorepoRoot) : false;
	const packageDeclaresKnipDependency = packageDeclaresKnip(rootDirectory);
	if (!monorepoDeclaresKnip && !packageDeclaresKnipDependency) {
		return null;
	}

	const binPath = findBundledKnipBin();
	if (!binPath) return null;

	const cwd = monorepoRoot && monorepoDeclaresKnip ? monorepoRoot : rootDirectory;
	return { binPath, cwd };
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
		const absolutePath = getSafeUnusedFilePath(rootDirectory, d.filePath);
		if (absolutePath) {
			fs.unlinkSync(absolutePath);
		}
	}
};

export const runKnip = async (rootDirectory: string): Promise<Diagnostic[]> => {
	const monorepoRoot = findMonorepoRoot(rootDirectory);
	const knipRuntime = findKnipRuntime(rootDirectory, monorepoRoot);
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
			const filePath = getRelativePathWithinRoot(rootDirectory, knipRuntime.cwd, unusedFile);
			if (!filePath) continue;
			diagnostics.push({
				filePath,
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
