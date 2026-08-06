import { detectInvocation } from "../../ui/invocation.js";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic } from "../types.js";
import { isRecord, readRecordArray, readString } from "./audit-value.js";

export { parseDotnetAudit, runDotnetAudit } from "./audit-dotnet.js";

const withFixHint = (rest: string): string => {
	const invocation = detectInvocation();
	const suffix = rest ? ` — ${rest}` : "";
	return `Run \`${invocation} fix -f\` to apply this fix${suffix}`;
};

const dependencyDiagnostic = (filePath: string, message: string, help: string): Diagnostic => ({
	filePath,
	engine: "security",
	rule: "security/vulnerable-dependency",
	severity: "error",
	message,
	help,
	line: 0,
	column: 0,
	category: "Security",
	fixable: false,
});

export const runPipAudit = async (rootDir: string, timeout: number): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess("pip-audit", ["--format=json"], {
			cwd: rootDir,
			timeout,
		});
		if (!result.stdout) return [];
		const parsed: unknown = JSON.parse(result.stdout);
		if (!isRecord(parsed)) return [];
		return readRecordArray(parsed, "dependencies")
			.filter((dependency) => {
				const vulnerabilities = dependency.vulns;
				return Array.isArray(vulnerabilities) && vulnerabilities.length > 0;
			})
			.map((dependency) => {
				const name = readString(dependency, "name") ?? "unknown";
				return dependencyDiagnostic(
					"requirements.txt",
					`Vulnerable Python dependency: ${name}`,
					withFixHint(`Upgrade ${name} to fix known vulnerabilities`),
				);
			});
	} catch {
		return [];
	}
};

const toGovulnDiagnostic = (entry: Record<string, unknown>): Diagnostic | null => {
	const vulnerability = entry.vulnerability;
	if (!isRecord(vulnerability)) return null;
	return {
		filePath: "go.mod",
		engine: "security",
		rule: "security/vulnerable-dependency",
		severity: "error",
		message: `Go vulnerability: ${readString(vulnerability, "id") ?? "unknown"}`,
		help: withFixHint(readString(vulnerability, "details") ?? ""),
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

		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(parsed)) continue;

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
		const parsed: unknown = JSON.parse(result.stdout);
		if (!isRecord(parsed) || !isRecord(parsed.vulnerabilities)) return [];
		return readRecordArray(parsed.vulnerabilities, "list").map((vulnerability) => {
			const advisory = isRecord(vulnerability.advisory) ? vulnerability.advisory : {};
			return dependencyDiagnostic(
				"Cargo.toml",
				`Rust vulnerability: ${readString(advisory, "id") ?? "unknown"}`,
				withFixHint(readString(advisory, "title") ?? ""),
			);
		});
	} catch {
		return [];
	}
};
