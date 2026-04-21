// aislop-ignore-file duplicate-block
import fs from "node:fs";
import path from "node:path";
import { detectInvocation } from "../../ui/invocation.js";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic, EngineContext } from "../types.js";

const withFixHint = (rest: string): string => {
	const invocation = detectInvocation();
	const suffix = rest ? ` — ${rest}` : "";
	return `Run \`${invocation} fix -f\` to apply this fix${suffix}`;
};

export const runDependencyAudit = async (context: EngineContext): Promise<Diagnostic[]> => {
	const diagnostics: Diagnostic[] = [];
	const timeout = context.config.security.auditTimeout;

	const promises: Promise<Diagnostic[]>[] = [];

	// npm/pnpm audit
	if (context.languages.includes("typescript") || context.languages.includes("javascript")) {
		if (fs.existsSync(path.join(context.rootDirectory, "pnpm-lock.yaml"))) {
			promises.push(runPnpmAuditWithFallback(context.rootDirectory, timeout));
		} else if (
			fs.existsSync(path.join(context.rootDirectory, "package-lock.json")) ||
			fs.existsSync(path.join(context.rootDirectory, "package.json"))
		) {
			promises.push(runNpmAudit(context.rootDirectory, timeout));
		}
	}

	// pip-audit
	if (context.languages.includes("python") && context.installedTools["pip-audit"]) {
		promises.push(runPipAudit(context.rootDirectory, timeout));
	}

	// govulncheck
	if (context.languages.includes("go") && context.installedTools["govulncheck"]) {
		promises.push(runGovulncheck(context.rootDirectory, timeout));
	}

	// cargo audit
	if (context.languages.includes("rust")) {
		promises.push(runCargoAudit(context.rootDirectory, timeout));
	}

	const results = await Promise.allSettled(promises);
	for (const result of results) {
		if (result.status === "fulfilled") {
			diagnostics.push(...result.value);
		}
	}

	return diagnostics;
};

const runNpmAudit = async (rootDir: string, timeout: number): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess("npm", ["audit", "--json"], {
			cwd: rootDir,
			timeout,
		});
		return parseJsAudit(result.stdout, "npm audit");
	} catch {
		return [];
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
		const diagnostics = parseJsAudit(result.stdout, "pnpm audit");
		const hasAuditFailure = diagnostics.some((d) => d.rule === "security/dependency-audit-skipped");
		if (hasAuditFailure) {
			if (canFallbackToNpm) {
				return runNpmAudit(rootDir, timeout);
			}
			// pnpm audit failed due to an infrastructure/tooling issue, not a project problem — suppress.
			return [];
		}
		return diagnostics;
	} catch {
		if (canFallbackToNpm) {
			return runNpmAudit(rootDir, timeout);
		}
		return [];
	}
};

type JsAuditSource = "npm audit" | "pnpm audit";

const toSeverity = (value: string): "error" | "warning" =>
	value === "critical" || value === "high" ? "error" : "warning";

const defaultAuditFixCommand = (source: JsAuditSource): string =>
	source === "pnpm audit" ? "pnpm audit --fix" : "npm audit fix";

const parseLegacyAdvisories = (
	advisories: Record<string, Record<string, unknown>>,
	source: JsAuditSource,
): Diagnostic[] => {
	const diagnostics: Diagnostic[] = [];

	for (const [key, advisory] of Object.entries(advisories)) {
		const packageName =
			(advisory.module_name as string) ??
			(advisory.name as string) ??
			(advisory.package as string) ??
			key;
		const severity = ((advisory.severity as string) ?? "moderate").toLowerCase();
		const recommendation =
			(advisory.recommendation as string) ??
			(advisory.title as string) ??
			`Run \`${defaultAuditFixCommand(source)}\` to resolve`;

		diagnostics.push({
			filePath: "package.json",
			engine: "security",
			rule: "security/vulnerable-dependency",
			severity: toSeverity(severity),
			message: `Vulnerable dependency (${source}): ${packageName} (${severity})`,
			help: withFixHint(recommendation),
			line: 0,
			column: 0,
			category: "Security",
			fixable: false,
		});
	}

	return diagnostics;
};

const parseModernVulnerabilities = (
	vulnerabilities: Record<string, Record<string, unknown>>,
	source: JsAuditSource,
): Diagnostic[] => {
	const diagnostics: Diagnostic[] = [];

	for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
		const severity = ((vulnerability.severity as string) ?? "moderate").toLowerCase();

		const fixAvailable = vulnerability.fixAvailable;
		const isDirect = vulnerability.isDirect === true;
		let recommendation = `Run \`${defaultAuditFixCommand(source)}\` to resolve`;
		if (fixAvailable === false) {
			recommendation = isDirect
				? "No automatic fix — check for a newer major version"
				: "Transitive with no fix — add an override or upgrade the parent";
		} else if (!isDirect && fixAvailable === true) {
			recommendation = "Transitive dep — may need an override or parent upgrade";
		} else if (
			fixAvailable &&
			typeof fixAvailable === "object" &&
			"name" in fixAvailable &&
			"version" in fixAvailable
		) {
			const target = fixAvailable as { name?: string; version?: string };
			if (target.name && target.version) {
				recommendation = `Upgrade to ${target.name}@${target.version}.`;
			}
		}

		diagnostics.push({
			filePath: "package.json",
			engine: "security",
			rule: "security/vulnerable-dependency",
			severity: toSeverity(severity),
			message: `Vulnerable dependency (${source}): ${packageName} (${severity})`,
			help: withFixHint(recommendation),
			line: 0,
			column: 0,
			category: "Security",
			fixable: false,
		});
	}

	return diagnostics;
};

const parseJsAudit = (output: string, source: JsAuditSource): Diagnostic[] => {
	if (!output) return [];
	try {
		const parsed = JSON.parse(output) as Record<string, unknown>;

		const error = parsed.error as { code?: string; summary?: string; detail?: string } | undefined;
		if (error?.code === "ENOLOCK") {
			return [
				{
					filePath: "package.json",
					engine: "security",
					rule: "security/dependency-audit-skipped",
					severity: "info",
					message: `Dependency audit skipped (${source}): lockfile is missing`,
					help:
						error.detail ??
						"Generate a lockfile, then re-run `npx aislop scan` for dependency vulnerability checks.",
					line: 0,
					column: 0,
					category: "Security",
					fixable: false,
				},
			];
		}
		if (error?.summary || error?.code) {
			return [
				{
					filePath: "package.json",
					engine: "security",
					rule: "security/dependency-audit-skipped",
					severity: "info",
					message: `Dependency audit did not complete (${source})`,
					help:
						error.detail ??
						error.summary ??
						"Re-run dependency audit directly to inspect the underlying error.",
					line: 0,
					column: 0,
					category: "Security",
					fixable: false,
				},
			];
		}

		const advisories = parsed.advisories;
		if (advisories && typeof advisories === "object") {
			return parseLegacyAdvisories(advisories as Record<string, Record<string, unknown>>, source);
		}

		const vulnerabilities = parsed.vulnerabilities;
		if (vulnerabilities && typeof vulnerabilities === "object") {
			return parseModernVulnerabilities(
				vulnerabilities as Record<string, Record<string, unknown>>,
				source,
			);
		}

		return [];
	} catch {
		return [];
	}
};

const runPipAudit = async (rootDir: string, timeout: number): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess("pip-audit", ["--format=json"], {
			cwd: rootDir,
			timeout,
		});
		if (!result.stdout) return [];
		const parsed = JSON.parse(result.stdout);
		return (parsed.dependencies ?? [])
			.filter(
				(d: Record<string, unknown>) => Array.isArray(d.vulns) && (d.vulns as unknown[]).length > 0,
			)
			.map((d: Record<string, unknown>) => ({
				filePath: "requirements.txt",
				engine: "security" as const,
				rule: "security/vulnerable-dependency",
				severity: "error" as const,
				message: `Vulnerable Python dependency: ${d.name}`,
				help: withFixHint(`Upgrade ${d.name} to fix known vulnerabilities`),
				line: 0,
				column: 0,
				category: "Security",
				fixable: false,
			}));
	} catch {
		return [];
	}
};

const runGovulncheck = async (rootDir: string, timeout: number): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess("govulncheck", ["-json", "./..."], {
			cwd: rootDir,
			timeout,
		});
		if (!result.stdout) return [];
		return parseGovulncheckOutput(result.stdout);
	} catch {
		return [];
	}
};

interface GovulncheckEntry {
	vulnerability?: {
		id?: string;
		details?: string;
	};
}

const toGovulnDiagnostic = (entry: GovulncheckEntry): Diagnostic | null => {
	if (!entry.vulnerability) return null;
	return {
		filePath: "go.mod",
		engine: "security",
		rule: "security/vulnerable-dependency",
		severity: "error",
		message: `Go vulnerability: ${entry.vulnerability.id ?? "unknown"}`,
		help: withFixHint(entry.vulnerability.details ?? ""),
		line: 0,
		column: 0,
		category: "Security",
		fixable: false,
	};
};

const parseGovulncheckOutput = (output: string): Diagnostic[] => {
	const diagnostics: Diagnostic[] = [];
	for (const line of output.split("\n")) {
		if (!line.startsWith("{")) continue;

		let parsed: GovulncheckEntry | null = null;
		try {
			parsed = JSON.parse(line) as GovulncheckEntry;
		} catch {
			parsed = null;
		}
		if (!parsed) continue;

		const diagnostic = toGovulnDiagnostic(parsed);
		if (diagnostic) diagnostics.push(diagnostic);
	}
	return diagnostics;
};

const runCargoAudit = async (rootDir: string, timeout: number): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess("cargo", ["audit", "--json"], {
			cwd: rootDir,
			timeout,
		});
		if (!result.stdout) return [];
		const parsed = JSON.parse(result.stdout);
		return (parsed.vulnerabilities?.list ?? []).map((v: Record<string, unknown>) => ({
			filePath: "Cargo.toml",
			engine: "security" as const,
			rule: "security/vulnerable-dependency",
			severity: "error" as const,
			message: `Rust vulnerability: ${(v.advisory as Record<string, unknown>)?.id ?? "unknown"}`,
			help: withFixHint(
				((v.advisory as Record<string, unknown>)?.title as string | undefined) ?? "",
			),
			line: 0,
			column: 0,
			category: "Security",
			fixable: false,
		}));
	} catch {
		return [];
	}
};
