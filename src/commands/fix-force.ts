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

		const overrides: Record<string, string> = {};
		for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
			const fixAvailable = vuln.fixAvailable;
			if (fixAvailable === false) {
				// Check if there's a patched range we can override to
				const range = vuln.range as string | undefined;
				if (range) {
					// Try to find the latest non-vulnerable version
					const latestResult = await runSubprocess(
						"npm",
						["view", pkgName, "version", "--json"],
						{ cwd: rootDir, timeout: 10000 },
					);
					if (latestResult.stdout) {
						try {
							const latest = JSON.parse(latestResult.stdout) as string;
							overrides[pkgName] = latest;
						} catch {
							// skip if we can't parse
						}
					}
				}
			}
		}

		if (Object.keys(overrides).length === 0) return;

		// Add overrides to package.json
		const pkgPath = path.join(rootDir, "package.json");
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
		const existingOverrides = (pkg.overrides as Record<string, string>) || {};
		pkg.overrides = { ...existingOverrides, ...overrides };
		fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

		// Reinstall with overrides
		await runSubprocess("npm", ["install"], {
			cwd: rootDir,
			timeout: 180000,
		});
	} catch {
		// Override attempt is best-effort — don't fail the step
	}
};

export const fixExpoDependencies = async (context: EngineContext): Promise<void> => {
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
