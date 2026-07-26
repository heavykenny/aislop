import path from "node:path";
import { detectInvocation } from "../../ui/invocation.js";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic } from "../types.js";
import { SEVERITY_RANK, toSeverity } from "./audit-shared.js";

const withFixHint = (rest: string): string => {
	const invocation = detectInvocation();
	const suffix = rest ? ` — ${rest}` : "";
	return `Run \`${invocation} fix -f\` to apply this fix${suffix}`;
};

export const runPipAudit = async (rootDir: string, timeout: number): Promise<Diagnostic[]> => {
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

export const runGovulncheck = async (rootDir: string, timeout: number): Promise<Diagnostic[]> => {
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

export const runCargoAudit = async (rootDir: string, timeout: number): Promise<Diagnostic[]> => {
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

// dotnet / NuGet audit.
// `dotnet list package --vulnerable --include-transitive --format json` emits the
// schema projects -> frameworks -> {topLevelPackages, transitivePackages} -> packages,
// each package carrying id, resolvedVersion and a vulnerabilities list (severity,
// advisoryurl). NuGet severities are Low/Moderate/High/Critical; only vulnerable
// packages appear.

interface DotnetVulnerability {
	severity?: string;
	advisoryurl?: string;
}
interface DotnetPackage {
	id?: string;
	resolvedVersion?: string;
	vulnerabilities?: DotnetVulnerability[];
}
interface DotnetFramework {
	topLevelPackages?: DotnetPackage[];
	transitivePackages?: DotnetPackage[];
}
interface DotnetProject {
	path?: string;
	frameworks?: DotnetFramework[];
}
interface DotnetAuditReport {
	projects?: DotnetProject[];
}

const toDotnetDiagnostic = (
	pkg: DotnetPackage,
	projectFile: string,
	transitive: boolean,
): Diagnostic | null => {
	const vulns = pkg.vulnerabilities ?? [];
	if (vulns.length === 0 || !pkg.id) return null;

	const worstSeverity = vulns.reduce((worst, vuln) => {
		const severity = (vuln.severity ?? "moderate").toLowerCase();
		return (SEVERITY_RANK[severity] ?? 0) > (SEVERITY_RANK[worst] ?? 0) ? severity : worst;
	}, "low");
	const advisory = vulns.find((vuln) => vuln.advisoryurl)?.advisoryurl ?? "";
	const scopeLabel = transitive ? " transitive" : "";
	const countLabel = vulns.length > 1 ? ` (${vulns.length} advisories)` : "";

	return {
		filePath: projectFile,
		engine: "security",
		rule: "security/vulnerable-dependency",
		severity: toSeverity(worstSeverity),
		message: `${pkg.id}@${pkg.resolvedVersion ?? "?"} (${worstSeverity})${scopeLabel}${countLabel}`,
		help: advisory
			? `See ${advisory}; upgrade ${pkg.id} to a patched version.`
			: `Upgrade ${pkg.id} to a patched version.`,
		line: 0,
		column: 0,
		category: "Security",
		fixable: false,
		detail: "dotnet",
	};
};

export const parseDotnetAudit = (output: string): Diagnostic[] => {
	if (!output) return [];
	let report: DotnetAuditReport;
	try {
		report = JSON.parse(output) as DotnetAuditReport;
	} catch {
		return [];
	}

	const diagnostics: Diagnostic[] = [];
	// A multi-targeted project lists the same vulnerable package once per framework;
	// dedupe so a net8/net10 project doesn't report each finding twice.
	const seen = new Set<string>();
	for (const project of report.projects ?? []) {
		const projectFile = project.path ? path.basename(project.path) : "*.csproj";
		for (const framework of project.frameworks ?? []) {
			const packages = [
				...(framework.topLevelPackages ?? []).map((pkg) => ({ pkg, transitive: false })),
				...(framework.transitivePackages ?? []).map((pkg) => ({ pkg, transitive: true })),
			];
			for (const { pkg, transitive } of packages) {
				const key = `${projectFile}:${pkg.id}:${transitive}`;
				if (seen.has(key)) continue;
				const diagnostic = toDotnetDiagnostic(pkg, projectFile, transitive);
				if (!diagnostic) continue;
				seen.add(key);
				diagnostics.push(diagnostic);
			}
		}
	}
	return diagnostics;
};

export const runDotnetAudit = async (rootDir: string, timeout: number): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess(
			"dotnet",
			["list", "package", "--vulnerable", "--include-transitive", "--format", "json"],
			{ cwd: rootDir, timeout },
		);
		return parseDotnetAudit(result.stdout);
	} catch {
		return [];
	}
};
