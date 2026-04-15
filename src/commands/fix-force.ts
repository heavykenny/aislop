import fs from "node:fs";
import path from "node:path";
import type { EngineContext } from "../engines/types.js";
import { runSubprocess } from "../utils/subprocess.js";

const getJsAuditFixCommand = (
	rootDirectory: string,
): { command: string; args: string[] } | null => {
	if (fs.existsSync(path.join(rootDirectory, "pnpm-lock.yaml"))) {
		return { command: "pnpm", args: ["audit", "--fix"] };
	}

	if (
		fs.existsSync(path.join(rootDirectory, "package-lock.json")) ||
		fs.existsSync(path.join(rootDirectory, "package.json"))
	) {
		return { command: "npm", args: ["audit", "fix"] };
	}

	return null;
};

export const fixDependencyAudit = async (context: EngineContext): Promise<void> => {
	const auditFix = getJsAuditFixCommand(context.rootDirectory);
	if (!auditFix) return;

	// Step 1: Run standard audit fix
	const result = await runSubprocess(auditFix.command, auditFix.args, {
		cwd: context.rootDirectory,
		timeout: 180000,
	});

	// npm audit fix exits non-zero when vulns remain — that's expected
	// Only throw on actual command failures (not just unresolved vulns)
	if (result.exitCode !== 0 && !result.stdout && !result.stderr) {
		throw new Error(`${auditFix.command} audit fix failed`);
	}

	// Step 2: Install to apply changes
	const installResult = await runSubprocess(auditFix.command, ["install"], {
		cwd: context.rootDirectory,
		timeout: 180000,
	});

	if (installResult.exitCode !== 0) {
		throw new Error(
			installResult.stderr ||
				installResult.stdout ||
				`${auditFix.command} install failed after audit fix`,
		);
	}

	// Step 3: Check if vulns remain — try overrides for npm
	if (auditFix.command === "npm") {
		await tryNpmOverrides(context.rootDirectory);
	}
};

/**
 * For unresolvable transitive vulnerabilities, attempt to add npm overrides
 * in package.json. This forces a newer version of the vulnerable transitive dep.
 */
const fetchLatestVersion = async (rootDir: string, pkgName: string): Promise<string | null> => {
	try {
		const result = await runSubprocess("npm", ["view", pkgName, "version", "--json"], {
			cwd: rootDir,
			timeout: 10000,
		});
		return result.stdout ? (JSON.parse(result.stdout) as string) : null;
	} catch {
		return null;
	}
};

const collectOverrides = async (
	rootDir: string,
	vulnerabilities: Record<string, Record<string, unknown>>,
): Promise<Record<string, string>> => {
	const overrides: Record<string, string> = {};
	for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
		if (vuln.fixAvailable !== false || !vuln.range) continue;
		const latest = await fetchLatestVersion(rootDir, pkgName);
		if (latest) overrides[pkgName] = latest;
	}
	return overrides;
};

const tryNpmOverrides = async (rootDir: string): Promise<void> => {
	try {
		const auditResult = await runSubprocess("npm", ["audit", "--json"], {
			cwd: rootDir,
			timeout: 30000,
		});
		if (!auditResult.stdout) return;

		const parsed = JSON.parse(auditResult.stdout) as Record<string, unknown>;
		const vulnerabilities = parsed.vulnerabilities as
			| Record<string, Record<string, unknown>>
			| undefined;
		if (!vulnerabilities) return;

		const overrides = await collectOverrides(rootDir, vulnerabilities);
		if (Object.keys(overrides).length === 0) return;

		const pkgPath = path.join(rootDir, "package.json");
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
		const existing = (pkg.overrides as Record<string, string>) || {};
		pkg.overrides = { ...existing, ...overrides };
		fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

		await runSubprocess("npm", ["install"], { cwd: rootDir, timeout: 180000 });
	} catch {
		// best-effort
	}
};

export const fixExpoDependencies = async (context: EngineContext): Promise<void> => {
	// Step 1: Remove packages that should not be installed directly
	await removeDisallowedExpoPackages(context.rootDirectory);

	// Step 2: Fix version alignment
	const fixResult = await runSubprocess("npx", ["--yes", "expo", "install", "--fix"], {
		cwd: context.rootDirectory,
		timeout: 180000,
	});

	if (fixResult.exitCode === 0) return;

	const checkResult = await runSubprocess("npx", ["--yes", "expo", "install", "--check"], {
		cwd: context.rootDirectory,
		timeout: 180000,
	});

	if (checkResult.exitCode !== 0) {
		throw new Error(checkResult.stderr || checkResult.stdout || "expo dependency check failed");
	}
};

/**
 * Run expo-doctor to detect packages that should not be installed directly,
 * then uninstall them. No hardcoded list — expo-doctor is the source of truth.
 */
const removeDisallowedExpoPackages = async (rootDir: string): Promise<void> => {
	try {
		// Run expo-doctor and parse its output for disallowed packages
		const result = await runSubprocess("npx", ["--yes", "expo-doctor", rootDir], {
			cwd: rootDir,
			timeout: 120000,
		});
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

		// Parse: 'The package "expo-modules-core" should not be installed directly'
		const packagePattern = /The package "([^"]+)" should not be installed directly/g;
		const toRemove: string[] = [];
		let match: RegExpExecArray | null;
		while ((match = packagePattern.exec(output)) !== null) {
			toRemove.push(match[1]);
		}

		if (toRemove.length === 0) return;

		await runSubprocess("npm", ["uninstall", ...toRemove], {
			cwd: rootDir,
			timeout: 60000,
		});
	} catch {
		// Best-effort — don't fail the step
	}
};
