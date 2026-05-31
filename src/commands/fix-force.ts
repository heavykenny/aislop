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
	const pnpmOk = await tryPnpmOverrides(context.rootDirectory, onProgress);
	if (pnpmOk) return;

	// pnpm audit is unreachable (e.g. 410 retired endpoint). Fall back to npm.
	if (fs.existsSync(path.join(context.rootDirectory, "package-lock.json"))) {
		await runNpmAuditFix(context.rootDirectory, onProgress);
		await tryNpmOverrides(context.rootDirectory, onProgress);
		return;
	}

	onProgress?.(
		"Dependency audit fixes · skipping (pnpm audit unavailable and no package-lock.json for npm fallback)",
	);
};

const SEMVER_PREFIX_RE = /^[~^]?/;

export const parseSemverMin = (spec: string): [number, number, number] | null => {
	const stripped = spec.replace(SEMVER_PREFIX_RE, "");
	const match = stripped.match(/^(\d+|x|X|\*)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?/);
	if (!match) return null;
	const head = match[1];
	if (!/^\d+$/.test(head)) return null;
	const toNum = (part: string | undefined): number => {
		if (!part) return 0;
		return /^\d+$/.test(part) ? Number(part) : 0;
	};
	return [Number(head), toNum(match[2]), toNum(match[3])];
};

export const isDowngrade = (oldSpec: string, newSpec: string): boolean => {
	const oldV = parseSemverMin(oldSpec);
	const newV = parseSemverMin(newSpec);
	if (!oldV || !newV) return false;
	for (let i = 0; i < 3; i++) {
		if ((newV[i] ?? 0) < (oldV[i] ?? 0)) return true;
		if ((newV[i] ?? 0) > (oldV[i] ?? 0)) return false;
	}
	return false;
};

type DepBucket = "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";
const DEP_BUCKETS: DepBucket[] = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
];

const snapshotPackageVersions = (pkg: Record<string, unknown>): Map<string, string> => {
	const map = new Map<string, string>();
	for (const bucket of DEP_BUCKETS) {
		const deps = pkg[bucket];
		if (!deps || typeof deps !== "object") continue;
		for (const [name, version] of Object.entries(deps as Record<string, string>)) {
			if (typeof version === "string") map.set(`${bucket}:${name}`, version);
		}
	}
	return map;
};

const revertDowngrades = (rootDir: string, before: Map<string, string>): string[] => {
	const pkgPath = path.join(rootDir, "package.json");
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
	const reverted: string[] = [];
	for (const bucket of DEP_BUCKETS) {
		const deps = pkg[bucket] as Record<string, string> | undefined;
		if (!deps) continue;
		for (const [name, version] of Object.entries(deps)) {
			const prior = before.get(`${bucket}:${name}`);
			if (!prior) continue;
			if (isDowngrade(prior, version)) {
				deps[name] = prior;
				reverted.push(`${name} ${version} → ${prior}`);
			}
		}
	}
	if (reverted.length > 0) {
		fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
	}
	return reverted;
};

const runNpmAuditFix = async (
	rootDir: string,
	onProgress?: (label: string) => void,
): Promise<void> => {
	const pkgPath = path.join(rootDir, "package.json");
	const before = snapshotPackageVersions(
		JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>,
	);

	onProgress?.("Dependency audit fixes · running npm audit fix (can take a few minutes)");
	const result = await runSubprocess("npm", ["audit", "fix"], {
		cwd: rootDir,
		timeout: INSTALL_TIMEOUT,
	});

	// npm audit fix exits non-zero when vulns remain — that's expected.
	if (result.exitCode !== 0 && !result.stdout && !result.stderr) {
		throw new Error("npm audit fix failed");
	}

	const reverted = revertDowngrades(rootDir, before);
	if (reverted.length > 0) {
		onProgress?.(
			`Dependency audit fixes · reverted ${reverted.length} downgrade(s): ${reverted.join(", ")}`,
		);
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

const collectOverrides = async (
	rootDir: string,
	vulnerabilities: Record<string, Record<string, unknown>>,
	pm: PackageManager,
): Promise<Record<string, string>> => {
	const overrides: Record<string, string> = {};
	for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
		if (vuln.fixAvailable !== false || !vuln.range) continue;
		const latest = await fetchLatestVersion(rootDir, pkgName, pm);
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

		const rawOverrides = await collectOverrides(rootDir, vulnerabilities, "npm");
		if (Object.keys(rawOverrides).length === 0) return;

		const overrides = guardAndReport(rootDir, rawOverrides, onProgress);
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

const overrideName = (key: string): string => {
	const at = key.lastIndexOf("@");
	return at > 0 ? key.slice(0, at) : key;
};

// A "fix" that pins a package below what is already installed is a regression, not
// a fix, so drop it and let the caller flag it for the human to verify intent.
export const guardOverrides = (
	overrides: Record<string, string>,
	installed: Map<string, string>,
): { safe: Record<string, string>; skipped: string[] } => {
	const safe: Record<string, string> = {};
	const skipped: string[] = [];
	for (const [key, target] of Object.entries(overrides)) {
		const current = installed.get(overrideName(key));
		if (current && isDowngrade(current, target)) {
			skipped.push(`${overrideName(key)} ${current} → ${target}`);
			continue;
		}
		safe[key] = target;
	}
	return { safe, skipped };
};

const readRootNodeModulesVersion = (rootDir: string, name: string): string | null => {
	try {
		const manifest = path.join(rootDir, "node_modules", name, "package.json");
		const version = (JSON.parse(fs.readFileSync(manifest, "utf-8")) as { version?: unknown })
			.version;
		return typeof version === "string" ? version : null;
	} catch {
		return null;
	}
};

const PNPM_STORE_VERSION_RE = /^(\d+\.\d+\.\d+[^_(]*)/;

const isHigherVersion = (candidate: string, current: string | null): boolean => {
	if (!current) return true;
	const a = parseSemverMin(candidate);
	const b = parseSemverMin(current);
	if (!a || !b) return false;
	for (let i = 0; i < 3; i++) {
		if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
		if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
	}
	return false;
};

// pnpm stores non-hoisted packages as node_modules/.pnpm/<name>@<version> (scoped
// slash becomes a plus); take the highest version since pinning below it downgrades.
const readPnpmStoreVersion = (rootDir: string, name: string): string | null => {
	let entries: string[];
	try {
		entries = fs.readdirSync(path.join(rootDir, "node_modules", ".pnpm"));
	} catch {
		return null;
	}
	const prefix = `${name.replace(/\//g, "+")}@`;
	let best: string | null = null;
	for (const entry of entries) {
		if (!entry.startsWith(prefix)) continue;
		const match = PNPM_STORE_VERSION_RE.exec(entry.slice(prefix.length));
		if (match && isHigherVersion(match[1], best)) best = match[1];
	}
	return best;
};

export const readInstalledVersions = (rootDir: string, names: string[]): Map<string, string> => {
	const map = new Map<string, string>();
	for (const name of names) {
		const version =
			readRootNodeModulesVersion(rootDir, name) ?? readPnpmStoreVersion(rootDir, name);
		if (version) map.set(name, version);
	}
	return map;
};

const guardAndReport = (
	rootDir: string,
	rawOverrides: Record<string, string>,
	onProgress?: (label: string) => void,
): Record<string, string> => {
	const installed = readInstalledVersions(rootDir, Object.keys(rawOverrides).map(overrideName));
	const { safe, skipped } = guardOverrides(rawOverrides, installed);
	if (skipped.length > 0) {
		onProgress?.(
			`Dependency audit fixes · skipped ${skipped.length} downgrade(s), verify intent: ${skipped.join(", ")}`,
		);
	}
	return safe;
};

// Detects the retired pnpm audit endpoint (HTTP 410) or other signals that
// pnpm's audit registry call failed, so callers can fall back to npm.
const isPnpmAuditRetired = (stdout: string, stderr: string): boolean => {
	const haystack = `${stdout}\n${stderr}`.toLowerCase();
	return (
		haystack.includes("410") ||
		haystack.includes("gone") ||
		haystack.includes("retired") ||
		haystack.includes("endpoint") ||
		haystack.includes("err_pnpm_audit") ||
		haystack.includes("audit endpoint")
	);
};

const tryPnpmOverrides = async (
	rootDir: string,
	onProgress?: (label: string) => void,
): Promise<boolean> => {
	onProgress?.("Dependency audit fixes · running pnpm audit");
	const auditResult = await runSubprocess("pnpm", ["audit", "--json"], {
		cwd: rootDir,
		timeout: AUDIT_TIMEOUT,
	});

	if (!auditResult.stdout) {
		if (isPnpmAuditRetired(auditResult.stdout ?? "", auditResult.stderr ?? "")) {
			return false;
		}
		// No output and no identifiable retirement signal — treat as a clean run.
		return auditResult.exitCode === 0;
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(auditResult.stdout) as Record<string, unknown>;
	} catch {
		// Unparseable output from a non-zero exit usually means the endpoint is
		// unreachable (registry error pages, etc.). Signal fallback.
		if (
			auditResult.exitCode !== 0 ||
			isPnpmAuditRetired(auditResult.stdout, auditResult.stderr ?? "")
		) {
			return false;
		}
		return true;
	}

	const advisories = parsed.advisories as Record<string, PnpmAdvisory> | undefined;
	if (!advisories || Object.keys(advisories).length === 0) return true;

	const rawOverrides = collectPnpmOverrides(advisories);
	if (Object.keys(rawOverrides).length === 0) return true;

	const overrides = guardAndReport(rootDir, rawOverrides, onProgress);
	if (Object.keys(overrides).length === 0) return true;

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
	return true;
};
