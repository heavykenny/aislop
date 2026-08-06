import { detectInvocation } from "../../ui/invocation.js";
import { projectRelativePosix } from "../../utils/paths.js";
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

// One vulnerable package in one project, merged across every target framework it
// appears under.
interface DotnetFinding {
	projectFile: string;
	packageId: string;
	transitive: boolean;
	resolvedVersion: string;
	worstSeverity: string;
	vulnerabilities: DotnetVulnerability[];
}

const severityRank = (severity: string): number => SEVERITY_RANK[severity] ?? 0;

const worstSeverityOf = (vulnerabilities: DotnetVulnerability[]): string =>
	vulnerabilities.reduce((worst, vulnerability) => {
		const severity = (vulnerability.severity ?? "moderate").toLowerCase();
		return severityRank(severity) > severityRank(worst) ? severity : worst;
	}, "low");

// A multi-targeted project repeats the same advisory once per framework, so collapse
// identical (severity, advisory) pairs before counting them.
const dedupeVulnerabilities = (vulnerabilities: DotnetVulnerability[]): DotnetVulnerability[] => {
	const seen = new Set<string>();
	return vulnerabilities.filter((vulnerability) => {
		const key = `${(vulnerability.severity ?? "").toLowerCase()}|${vulnerability.advisoryurl ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

const toDotnetFinding = (
	pkg: DotnetPackage,
	projectFile: string,
	transitive: boolean,
): DotnetFinding | null => {
	const vulnerabilities = dedupeVulnerabilities(pkg.vulnerabilities ?? []);
	if (vulnerabilities.length === 0 || !pkg.id) return null;
	return {
		projectFile,
		packageId: pkg.id,
		transitive,
		resolvedVersion: pkg.resolvedVersion ?? "?",
		worstSeverity: worstSeverityOf(vulnerabilities),
		vulnerabilities,
	};
};

// The same package can resolve to a different version - and so to a different
// advisory set - under each target framework. Report the worst of them, carrying the
// version and advisory that severity came from, rather than whichever framework the
// report happened to list first.
const mergeDotnetFindings = (existing: DotnetFinding, incoming: DotnetFinding): DotnetFinding => {
	const worst =
		severityRank(incoming.worstSeverity) > severityRank(existing.worstSeverity)
			? incoming
			: existing;
	return {
		...worst,
		vulnerabilities: dedupeVulnerabilities([
			...existing.vulnerabilities,
			...incoming.vulnerabilities,
		]),
	};
};

const toDotnetDiagnostic = (finding: DotnetFinding): Diagnostic => {
	const advisory =
		finding.vulnerabilities.find(
			(vulnerability) =>
				vulnerability.advisoryurl &&
				(vulnerability.severity ?? "moderate").toLowerCase() === finding.worstSeverity,
		)?.advisoryurl ??
		finding.vulnerabilities.find((vulnerability) => vulnerability.advisoryurl)?.advisoryurl ??
		"";
	const scopeLabel = finding.transitive ? " transitive" : "";
	const countLabel =
		finding.vulnerabilities.length > 1 ? ` (${finding.vulnerabilities.length} advisories)` : "";

	return {
		filePath: finding.projectFile,
		engine: "security",
		rule: "security/vulnerable-dependency",
		severity: toSeverity(finding.worstSeverity),
		message: `${finding.packageId}@${finding.resolvedVersion} (${finding.worstSeverity})${scopeLabel}${countLabel}`,
		help: advisory
			? `See ${advisory}; upgrade ${finding.packageId} to a patched version.`
			: `Upgrade ${finding.packageId} to a patched version.`,
		line: 0,
		column: 0,
		category: "Security",
		fixable: false,
		detail: "dotnet",
	};
};

export const parseDotnetAudit = (output: string, rootDirectory: string): Diagnostic[] => {
	if (!output) return [];
	let report: DotnetAuditReport;
	try {
		report = JSON.parse(output) as DotnetAuditReport;
	} catch {
		return [];
	}

	const findings = new Map<string, DotnetFinding>();
	for (const project of report.projects ?? []) {
		// Keep the whole root-relative path: reducing "src/App/App.csproj" to its
		// basename points the diagnostic at a file that does not exist, hides the
		// project from the exclude filter, and conflates projects that share a
		// basename.
		const projectFile = project.path
			? projectRelativePosix(rootDirectory, project.path)
			: "*.csproj";
		for (const framework of project.frameworks ?? []) {
			const packages = [
				...(framework.topLevelPackages ?? []).map((pkg) => ({ pkg, transitive: false })),
				...(framework.transitivePackages ?? []).map((pkg) => ({ pkg, transitive: true })),
			];
			for (const { pkg, transitive } of packages) {
				const finding = toDotnetFinding(pkg, projectFile, transitive);
				if (!finding) continue;
				const key = `${projectFile}:${finding.packageId}:${transitive}`;
				const existing = findings.get(key);
				findings.set(key, existing ? mergeDotnetFindings(existing, finding) : finding);
			}
		}
	}
	return [...findings.values()].map(toDotnetDiagnostic);
};

export const runDotnetAudit = async (rootDir: string, timeout: number): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess(
			"dotnet",
			[
				"list",
				"package",
				"--no-restore",
				"--vulnerable",
				"--include-transitive",
				"--format",
				"json",
			],
			{ cwd: rootDir, timeout },
		);
		return parseDotnetAudit(result.stdout, rootDir);
	} catch {
		return [];
	}
};
