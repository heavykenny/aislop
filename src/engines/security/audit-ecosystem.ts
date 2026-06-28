import { detectInvocation } from "../../ui/invocation.js";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic } from "../types.js";

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
