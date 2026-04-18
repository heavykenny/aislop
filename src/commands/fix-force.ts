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

const INSTALL_TIMEOUT = 30 * 60 * 1000;

export const fixDependencyAudit = async (
	context: EngineContext,
	onProgress?: (label: string) => void,
): Promise<void> => {
	const auditFix = getJsAuditFixCommand(context.rootDirectory);
	if (!auditFix) return;

	onProgress?.(
		`Dependency audit fixes · running ${auditFix.command} audit fix (can take a few minutes)`,
	);
	const result = await runSubprocess(auditFix.command, auditFix.args, {
		cwd: context.rootDirectory,
		timeout: INSTALL_TIMEOUT,
	});

	// npm audit fix exits non-zero when vulns remain — that's expected
	// Only throw on actual command failures (not just unresolved vulns)
	if (result.exitCode !== 0 && !result.stdout && !result.stderr) {
		throw new Error(`${auditFix.command} audit fix failed`);
	}

	onProgress?.(`Dependency audit fixes · running ${auditFix.command} install`);
	const installResult = await runSubprocess(auditFix.command, ["install"], {
		cwd: context.rootDirectory,
		timeout: INSTALL_TIMEOUT,
	});

	if (installResult.exitCode !== 0) {
		throw new Error(
			installResult.stderr ||
				installResult.stdout ||
				`${auditFix.command} install failed after audit fix`,
		);
	}

	if (auditFix.command === "npm") {
		await tryNpmOverrides(context.rootDirectory, onProgress);
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

const tryNpmOverrides = async (
	rootDir: string,
	onProgress?: (label: string) => void,
): Promise<void> => {
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

		onProgress?.("Dependency audit fixes · applying npm overrides (npm install)");
		await runSubprocess("npm", ["install"], { cwd: rootDir, timeout: INSTALL_TIMEOUT });
	} catch {
		// best-effort
	}
};

export const fixExpoDependencies = async (
	context: EngineContext,
	onProgress?: (label: string) => void,
): Promise<void> => {
	await removeDisallowedExpoPackages(context.rootDirectory, onProgress);

	onProgress?.("Expo dependency alignment · running expo install --fix (can take a few minutes)");
	const fixResult = await runSubprocess("npx", ["--yes", "expo", "install", "--fix"], {
		cwd: context.rootDirectory,
		timeout: INSTALL_TIMEOUT,
	});

	if (fixResult.exitCode === 0) return;

	onProgress?.("Expo dependency alignment · checking remaining issues");
	const checkResult = await runSubprocess("npx", ["--yes", "expo", "install", "--check"], {
		cwd: context.rootDirectory,
		timeout: INSTALL_TIMEOUT,
	});

	if (checkResult.exitCode !== 0) {
		throw new Error(checkResult.stderr || checkResult.stdout || "expo dependency check failed");
	}
};

/**
 * Run expo-doctor to detect packages that should not be installed directly,
 * then uninstall them. No hardcoded list — expo-doctor is the source of truth.
 */
const removeDisallowedExpoPackages = async (
	rootDir: string,
	onProgress?: (label: string) => void,
): Promise<void> => {
	try {
		// Run expo-doctor and parse its output for disallowed packages
		onProgress?.("Expo dependency alignment · running expo-doctor");
		const result = await runSubprocess("npx", ["--yes", "expo-doctor", rootDir], {
			cwd: rootDir,
			timeout: INSTALL_TIMEOUT,
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

		onProgress?.(`Expo dependency alignment · uninstalling ${toRemove.length} package(s)`);
		await runSubprocess("npm", ["uninstall", ...toRemove], {
			cwd: rootDir,
			timeout: INSTALL_TIMEOUT,
		});
	} catch {
		// Best-effort — don't fail the step
	}
};
