// aislop-ignore-file duplicate-block
import fs from "node:fs";
import path from "node:path";
import { isDependencyAuditInputFile } from "../../utils/source-file-selection.js";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic, EngineContext } from "../types.js";
import { runCargoAudit, runDotnetAudit, runGovulncheck, runPipAudit } from "./audit-ecosystem.js";
import {
	type JsAuditManifest,
	type JsAuditSource,
	parseBunAudit,
	parseJsAudit,
} from "./audit-js-parser.js";

export { parseDotnetAudit } from "./audit-ecosystem.js";
export { parseBunAudit, parseJsAudit } from "./audit-js-parser.js";

const toRelativePath = (rootDirectory: string, filePath: string): string => {
	const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(rootDirectory, filePath);
	return path.relative(rootDirectory, absolute).split(path.sep).join("/");
};

export const shouldRunDependencyAudit = (context: EngineContext): boolean => {
	if (context.dependencyAuditScope === "full") return true;
	const scopedFiles = context.dependencyAuditFiles ?? context.files;
	if (!scopedFiles) return true;
	return scopedFiles.some((file) =>
		isDependencyAuditInputFile(toRelativePath(context.rootDirectory, file)),
	);
};

// Dependency metadata that makes pip-audit meaningful for this project (mirrors the
// PYTHON_SIGNALS used for language detection). A bare `pip-audit` invocation audits the
// ambient Python environment aislop runs under, not the repo, so when none of these is
// present - e.g. a source-only tree now detected as Python, or an unscoped run with no
// `context.files` - the dependency audit must stay off rather than report environment
// vulnerabilities against a requirements.txt that does not exist.
const PYTHON_DEPENDENCY_MANIFESTS = [
	"requirements.txt",
	"pyproject.toml",
	"setup.py",
	"setup.cfg",
	"Pipfile",
	"poetry.lock",
];

const hasPythonDependencyManifest = (rootDir: string): boolean =>
	PYTHON_DEPENDENCY_MANIFESTS.some((file) => fs.existsSync(path.join(rootDir, file)));

export const runDependencyAudit = async (context: EngineContext): Promise<Diagnostic[]> => {
	if (!shouldRunDependencyAudit(context)) return [];

	const diagnostics: Diagnostic[] = [];
	const timeout = context.config.security.auditTimeout;
	const auditLanguages = context.dependencyAuditLanguages ?? context.languages;

	const promises: Promise<Diagnostic[]>[] = [];

	// npm/pnpm/bun audit
	if (auditLanguages.includes("typescript") || auditLanguages.includes("javascript")) {
		if (fs.existsSync(path.join(context.rootDirectory, "pnpm-lock.yaml"))) {
			promises.push(runPnpmAuditWithFallback(context.rootDirectory, timeout));
		} else if (hasBunLockfile(context.rootDirectory)) {
			promises.push(runBunAudit(context.rootDirectory, timeout));
		} else if (
			fs.existsSync(path.join(context.rootDirectory, "package-lock.json")) ||
			fs.existsSync(path.join(context.rootDirectory, "package.json"))
		) {
			promises.push(runNpmAudit(context.rootDirectory, timeout));
		}
	}

	// pip-audit. Requires a Python dependency manifest: bare pip-audit audits the ambient
	// environment, so without metadata to scope it the result describes aislop's own
	// interpreter, not the scanned project.
	if (
		auditLanguages.includes("python") &&
		context.installedTools["pip-audit"] &&
		hasPythonDependencyManifest(context.rootDirectory)
	) {
		promises.push(runPipAudit(context.rootDirectory, timeout));
	}

	// govulncheck
	if (auditLanguages.includes("go") && context.installedTools.govulncheck) {
		promises.push(runGovulncheck(context.rootDirectory, timeout));
	}

	// cargo audit
	if (auditLanguages.includes("rust")) {
		promises.push(runCargoAudit(context.rootDirectory, timeout));
	}

	// dotnet list package --vulnerable (NuGet). Keyed to the manifest-aware
	// audit languages like the other ecosystems: a .csproj is what the audit
	// needs, even when no .cs file is in the scan scope.
	if (
		auditLanguages.includes("csharp") &&
		context.installedTools.dotnet &&
		context.config.lint.csharp?.projectEvaluation === true
	) {
		promises.push(runDotnetAudit(context.rootDirectory, timeout));
	}

	const results = await Promise.allSettled(promises);
	for (const result of results) {
		if (result.status === "fulfilled") {
			diagnostics.push(...result.value);
		}
	}

	return diagnostics;
};

const hasBunLockfile = (rootDir: string): boolean =>
	fs.existsSync(path.join(rootDir, "bun.lock")) || fs.existsSync(path.join(rootDir, "bun.lockb"));

const errorMessageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const auditSkippedDiagnostic = (source: JsAuditSource, help: string): Diagnostic => ({
	filePath: "package.json",
	engine: "security",
	rule: "security/dependency-audit-skipped",
	severity: "info",
	message: `Dependency audit did not complete (${source})`,
	help,
	line: 0,
	column: 0,
	category: "Security",
	fixable: false,
});

/**
 * Packages the project actually ships. devDependencies are excluded so that test and
 * build tooling advisories can be demoted rather than scored as shipped defects.
 */
const readRuntimeDependencies = (rootDir: string): JsAuditManifest | undefined => {
	try {
		const raw = fs.readFileSync(path.join(rootDir, "package.json"), "utf-8");
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return undefined;

		const manifest = parsed as Record<string, unknown>;
		const names = new Set<string>();
		for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
			const section = manifest[field];
			if (section && typeof section === "object") {
				for (const name of Object.keys(section)) names.add(name);
			}
		}
		return { runtimeDependencies: names };
	} catch {
		return undefined;
	}
};

const runNpmAudit = async (rootDir: string, timeout: number): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess("npm", ["audit", "--json"], {
			cwd: rootDir,
			timeout,
		});
		return parseJsAudit(result.stdout, "npm audit", readRuntimeDependencies(rootDir));
	} catch (error) {
		return [
			auditSkippedDiagnostic("npm audit", `Failed to run npm audit: ${errorMessageOf(error)}`),
		];
	}
};

const runBunAudit = async (rootDir: string, timeout: number): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess("bun", ["audit", "--json"], {
			cwd: rootDir,
			timeout,
		});
		if (result.stdout) {
			return parseBunAudit(result.stdout);
		}
		if (result.exitCode === 0) return [];
		return [
			auditSkippedDiagnostic(
				"bun audit",
				`Failed to run bun audit: ${result.stderr || "unknown error"}`,
			),
		];
	} catch (error) {
		return [
			auditSkippedDiagnostic("bun audit", `Failed to run bun audit: ${errorMessageOf(error)}`),
		];
	}
};

const runPnpmAuditWithFallback = async (
	rootDir: string,
	timeout: number,
): Promise<Diagnostic[]> => {
	const canFallbackToNpm = fs.existsSync(path.join(rootDir, "package-lock.json"));

	try {
		const result = await runSubprocess("pnpm", ["audit", "--json"], {
			cwd: rootDir,
			timeout,
		});
		const diagnostics = parseJsAudit(result.stdout, "pnpm audit", readRuntimeDependencies(rootDir));
		const hasAuditFailure = diagnostics.some((d) => d.rule === "security/dependency-audit-skipped");
		if (hasAuditFailure) {
			if (canFallbackToNpm) {
				return runNpmAudit(rootDir, timeout);
			}
			return diagnostics;
		}
		return diagnostics;
	} catch (error) {
		if (canFallbackToNpm) {
			return runNpmAudit(rootDir, timeout);
		}
		return [
			auditSkippedDiagnostic("pnpm audit", `Failed to run pnpm audit: ${errorMessageOf(error)}`),
		];
	}
};
