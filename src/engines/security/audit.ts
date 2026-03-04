import fs from "node:fs";
import path from "node:path";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic, EngineContext } from "../types.js";

export const runDependencyAudit = async (
	context: EngineContext,
): Promise<Diagnostic[]> => {
	const diagnostics: Diagnostic[] = [];
	const timeout = context.config.security.auditTimeout;

	const promises: Promise<Diagnostic[]>[] = [];

	// npm/pnpm audit
	if (
		context.languages.includes("typescript") ||
		context.languages.includes("javascript")
	) {
		if (fs.existsSync(path.join(context.rootDirectory, "pnpm-lock.yaml"))) {
			promises.push(runPnpmAudit(context.rootDirectory, timeout));
		} else if (
			fs.existsSync(path.join(context.rootDirectory, "package-lock.json"))
		) {
			promises.push(runNpmAudit(context.rootDirectory, timeout));
		}
	}

	// pip-audit
	if (
		context.languages.includes("python") &&
		context.installedTools["pip-audit"]
	) {
		promises.push(runPipAudit(context.rootDirectory, timeout));
	}

	// govulncheck
	if (
		context.languages.includes("go") &&
		context.installedTools["govulncheck"]
	) {
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

const runNpmAudit = async (
	rootDir: string,
	timeout: number,
): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess("npm", ["audit", "--json"], {
			cwd: rootDir,
			timeout,
		});
		return parseNpmAudit(result.stdout);
	} catch {
		return [];
	}
};

const runPnpmAudit = async (
	rootDir: string,
	timeout: number,
): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess("pnpm", ["audit", "--json"], {
			cwd: rootDir,
			timeout,
		});
		return parseNpmAudit(result.stdout);
	} catch {
		return [];
	}
};

const parseNpmAudit = (output: string): Diagnostic[] => {
	if (!output) return [];
	try {
		const parsed = JSON.parse(output);
		const advisories = parsed.advisories ?? parsed.vulnerabilities ?? {};
		const diagnostics: Diagnostic[] = [];

		for (const [name, advisory] of Object.entries(advisories) as [
			string,
			Record<string, unknown>,
		][]) {
			const severity = (advisory.severity as string) ?? "moderate";
			diagnostics.push({
				filePath: "package.json",
				engine: "security",
				rule: "security/vulnerable-dependency",
				severity:
					severity === "critical" || severity === "high" ? "error" : "warning",
				message: `Vulnerable dependency: ${name} (${severity})`,
				help:
					(advisory.recommendation as string) ??
					`Run \`npm audit fix\` to resolve`,
				line: 0,
				column: 0,
				category: "Security",
				fixable: false,
			});
		}

		return diagnostics;
	} catch {
		return [];
	}
};

const runPipAudit = async (
	rootDir: string,
	timeout: number,
): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess("pip-audit", ["--format=json"], {
			cwd: rootDir,
			timeout,
		});
		if (!result.stdout) return [];
		const parsed = JSON.parse(result.stdout);
		return (parsed.dependencies ?? [])
			.filter(
				(d: Record<string, unknown>) =>
					Array.isArray(d.vulns) && (d.vulns as unknown[]).length > 0,
			)
			.map((d: Record<string, unknown>) => ({
				filePath: "requirements.txt",
				engine: "security" as const,
				rule: "security/vulnerable-dependency",
				severity: "error" as const,
				message: `Vulnerable Python dependency: ${d.name}`,
				help: `Upgrade ${d.name} to fix known vulnerabilities`,
				line: 0,
				column: 0,
				category: "Security",
				fixable: false,
			}));
	} catch {
		return [];
	}
};

const runGovulncheck = async (
	rootDir: string,
	timeout: number,
): Promise<Diagnostic[]> => {
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
		help: entry.vulnerability.details ?? "",
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

const runCargoAudit = async (
	rootDir: string,
	timeout: number,
): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess("cargo", ["audit", "--json"], {
			cwd: rootDir,
			timeout,
		});
		if (!result.stdout) return [];
		const parsed = JSON.parse(result.stdout);
		return (parsed.vulnerabilities?.list ?? []).map(
			(v: Record<string, unknown>) => ({
				filePath: "Cargo.toml",
				engine: "security" as const,
				rule: "security/vulnerable-dependency",
				severity: "error" as const,
				message: `Rust vulnerability: ${(v.advisory as Record<string, unknown>)?.id ?? "unknown"}`,
				help: (v.advisory as Record<string, unknown>)?.title ?? "",
				line: 0,
				column: 0,
				category: "Security",
				fixable: false,
			}),
		);
	} catch {
		return [];
	}
};
