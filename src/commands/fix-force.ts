import fs from "node:fs";
import path from "node:path";
import type { EngineContext } from "../engines/types.js";
import { runSubprocess } from "../utils/subprocess.js";

type PackageManager = "pnpm" | "npm";

const INSTALL_TIMEOUT = 30 * 60 * 1000;
const AUDIT_TIMEOUT = 60 * 1000;

const detectPackageManager = (rootDirectory: string): PackageManager | null => {
	if (fs.existsSync(path.join(rootDirectory, "pnpm-lock.yaml"))) return "pnpm";
	if (
		fs.existsSync(path.join(rootDirectory, "package-lock.json")) ||
		fs.existsSync(path.join(rootDirectory, "package.json"))
	) {
		return "npm";
	}
	return null;
};

export const fixDependencyAudit = async (
	context: EngineContext,
	onProgress?: (label: string) => void,
): Promise<void> => {
	const pm = detectPackageManager(context.rootDirectory);
	if (!pm) return;

	if (pm === "npm") {
		await runNpmAuditFix(context.rootDirectory, onProgress);
		await tryNpmOverrides(context.rootDirectory, onProgress);
		return;
	}

	// pnpm has no `audit --fix` subcommand. Transitive vulns are fixed via
	// `pnpm.overrides` in the root package.json.
	await tryPnpmOverrides(context.rootDirectory, onProgress);
};

const runNpmAuditFix = async (
	rootDir: string,
	onProgress?: (label: string) => void,
): Promise<void> => {
	onProgress?.("Dependency audit fixes · running npm audit fix (can take a few minutes)");
	const result = await runSubprocess("npm", ["audit", "fix"], {
		cwd: rootDir,
		timeout: INSTALL_TIMEOUT,
	});

	// npm audit fix exits non-zero when vulns remain — that's expected.
	if (result.exitCode !== 0 && !result.stdout && !result.stderr) {
		throw new Error("npm audit fix failed");
	}

	onProgress?.("Dependency audit fixes · running npm install");
	const installResult = await runSubprocess("npm", ["install"], {
		cwd: rootDir,
		timeout: INSTALL_TIMEOUT,
	});

	if (installResult.exitCode !== 0) {
		throw new Error(
			installResult.stderr || installResult.stdout || "npm install failed after audit fix",
		);
	}
};

const fetchLatestVersion = async (
	rootDir: string,
	pkgName: string,
	pm: PackageManager,
): Promise<string | null> => {
	try {
		const result = await runSubprocess(pm, ["view", pkgName, "version", "--json"], {
			cwd: rootDir,
			timeout: 10_000,
		});
		return result.stdout ? (JSON.parse(result.stdout) as string) : null;
	} catch {
		return null;
	}
};

const collectNpmOverrides = async (
	rootDir: string,
	vulnerabilities: Record<string, Record<string, unknown>>,
): Promise<Record<string, string>> => {
	const overrides: Record<string, string> = {};
	for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
		if (vuln.fixAvailable !== false || !vuln.range) continue;
		const latest = await fetchLatestVersion(rootDir, pkgName, "npm");
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
			timeout: AUDIT_TIMEOUT,
		});
		if (!auditResult.stdout) return;

		const parsed = JSON.parse(auditResult.stdout) as Record<string, unknown>;
		const vulnerabilities = parsed.vulnerabilities as
			| Record<string, Record<string, unknown>>
			| undefined;
		if (!vulnerabilities) return;

		const overrides = await collectNpmOverrides(rootDir, vulnerabilities);
		if (Object.keys(overrides).length === 0) return;

		const pkgPath = path.join(rootDir, "package.json");
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
		const existing = (pkg.overrides as Record<string, string>) || {};
		pkg.overrides = { ...existing, ...overrides };
		fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

		onProgress?.("Dependency audit fixes · applying npm overrides (npm install)");
		await runSubprocess("npm", ["install"], { cwd: rootDir, timeout: INSTALL_TIMEOUT });
	} catch {
		// best-effort
	}
};

export interface PnpmAdvisory {
	module_name?: string;
	patched_versions?: string;
	vulnerable_versions?: string;
}

export const patchedRangeToVersion = (patched: string): string | null => {
	const match = patched.match(/^\s*>=?\s*([0-9]+\.[0-9]+\.[0-9]+[^\s]*)/);
	return match ? `^${match[1]}` : null;
};

export const overrideKey = (
	name: string,
	vulnerable: string | undefined,
	patched: string,
): string => {
	if (vulnerable && vulnerable.trim().length > 0 && !/^\*$/.test(vulnerable.trim())) {
		return `${name}@${vulnerable.trim()}`;
	}
	const first = patched.match(/([0-9]+\.[0-9]+\.[0-9]+)/)?.[1];
	return first ? `${name}@<${first}` : name;
};

export const collectPnpmOverrides = (
	advisories: Record<string, PnpmAdvisory>,
): Record<string, string> => {
	const overrides: Record<string, string> = {};
	for (const adv of Object.values(advisories)) {
		if (!adv.module_name || !adv.patched_versions) continue;
		const target = patchedRangeToVersion(adv.patched_versions);
		if (!target) continue;
		const key = overrideKey(adv.module_name, adv.vulnerable_versions, adv.patched_versions);
		overrides[key] = target;
	}
	return overrides;
};

const tryPnpmOverrides = async (
	rootDir: string,
	onProgress?: (label: string) => void,
): Promise<void> => {
	onProgress?.("Dependency audit fixes · running pnpm audit");
	const auditResult = await runSubprocess("pnpm", ["audit", "--json"], {
		cwd: rootDir,
		timeout: AUDIT_TIMEOUT,
	});
	if (!auditResult.stdout) return;

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(auditResult.stdout) as Record<string, unknown>;
	} catch {
		return;
	}

	const advisories = parsed.advisories as Record<string, PnpmAdvisory> | undefined;
	if (!advisories || Object.keys(advisories).length === 0) return;

	const overrides = collectPnpmOverrides(advisories);
	if (Object.keys(overrides).length === 0) return;

	const pkgPath = path.join(rootDir, "package.json");
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
	const pnpmBlock = (pkg.pnpm as Record<string, unknown>) ?? {};
	const existing = (pnpmBlock.overrides as Record<string, string>) ?? {};
	pkg.pnpm = { ...pnpmBlock, overrides: { ...existing, ...overrides } };
	fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

	onProgress?.("Dependency audit fixes · applying pnpm overrides (pnpm install)");
	await runSubprocess("pnpm", ["install"], {
		cwd: rootDir,
		timeout: INSTALL_TIMEOUT,
	});
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

const removeDisallowedExpoPackages = async (
	rootDir: string,
	onProgress?: (label: string) => void,
): Promise<void> => {
	try {
		onProgress?.("Expo dependency alignment · running expo-doctor");
		const result = await runSubprocess("npx", ["--yes", "expo-doctor", rootDir], {
			cwd: rootDir,
			timeout: INSTALL_TIMEOUT,
		});
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

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
