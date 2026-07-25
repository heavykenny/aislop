import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectScanFileScope } from "../src/commands/scan-file-scope.js";
import { resolveScanScopeMode } from "../src/commands/scan-options.js";
import { shouldRunDependencyAudit } from "../src/engines/security/audit.js";
import type { EngineContext } from "../src/engines/types.js";

const context = (
	files?: string[],
	dependencyAuditScope?: "full" | "files",
	dependencyAuditFiles?: string[],
): EngineContext => ({
	rootDirectory: "/repo",
	languages: ["typescript", "python", "go", "rust"],
	frameworks: [],
	...(dependencyAuditFiles === undefined ? {} : { dependencyAuditFiles }),
	...(dependencyAuditScope === undefined ? {} : { dependencyAuditScope }),
	...(files === undefined ? {} : { files }),
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: true, auditTimeout: 25000 },
		lint: { typecheck: false, expoDoctor: false },
	},
});

const git = (cwd: string, args: string[]) => {
	execFileSync("git", args, { cwd, stdio: "ignore" });
};

const createGitFixture = (): string => {
	const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-audit-scope-"));
	fs.mkdirSync(path.join(rootDirectory, "src"));
	fs.writeFileSync(path.join(rootDirectory, "package.json"), '{"name":"fixture"}\n');
	fs.writeFileSync(path.join(rootDirectory, "src/index.ts"), "export const value = true;\n");
	git(rootDirectory, ["init"]);
	git(rootDirectory, ["config", "user.email", "test@example.com"]);
	git(rootDirectory, ["config", "user.name", "test"]);
	git(rootDirectory, ["config", "commit.gpgsign", "false"]);
	git(rootDirectory, ["add", "."]);
	git(rootDirectory, ["commit", "-m", "init", "--no-verify"]);
	return rootDirectory;
};

describe("dependency audit scope", () => {
	it("runs for full-project scans", () => {
		expect(shouldRunDependencyAudit(context())).toBe(true);
	});

	it("runs for full-project scans when source files are explicitly filtered", () => {
		expect(shouldRunDependencyAudit(context(["src/index.ts"], "full"))).toBe(true);
	});

	it("marks unscoped CI as a full-project dependency audit", () => {
		const rootDirectory = createGitFixture();
		try {
			const scanScope = collectScanFileScope({
				excludePatterns: [],
				includePatterns: [],
				mode: resolveScanScopeMode({
					changes: false,
					staged: false,
					verbose: false,
					json: true,
					command: "ci",
				}),
				rootDirectory,
			});
			expect(scanScope.dependencyAuditScope).toBe("full");
		} finally {
			fs.rmSync(rootDirectory, { recursive: true, force: true });
		}
	});

	it.each([
		{ changes: true, label: "--changes", staged: false },
		{ changes: false, label: "--staged", staged: true },
	])("runs a scoped audit when a manifest is changed with $label", ({ changes, staged }) => {
		const rootDirectory = createGitFixture();
		try {
			fs.writeFileSync(path.join(rootDirectory, "package.json"), '{"name":"changed"}\n');
			if (staged) git(rootDirectory, ["add", "package.json"]);
			const scanScope = collectScanFileScope({
				excludePatterns: [],
				includePatterns: [],
				mode: resolveScanScopeMode({
					changes,
					staged,
					verbose: false,
					json: true,
					command: "ci",
				}),
				rootDirectory,
			});
			expect(
				shouldRunDependencyAudit(
					context(scanScope.files, scanScope.dependencyAuditScope, scanScope.dependencyAuditFiles),
				),
			).toBe(true);
		} finally {
			fs.rmSync(rootDirectory, { recursive: true, force: true });
		}
	});

	it("skips scoped scans when no dependency manifest or lockfile is in scope", () => {
		expect(
			shouldRunDependencyAudit(context(["src/index.ts", "tests/secrets.test.ts"], "files")),
		).toBe(false);
	});

	it("runs scoped scans when dependency inputs are in scope", () => {
		expect(shouldRunDependencyAudit(context(["package.json"], "files"))).toBe(true);
		expect(shouldRunDependencyAudit(context(["pnpm-lock.yaml"], "files"))).toBe(true);
		expect(shouldRunDependencyAudit(context(["pyproject.toml"], "files"))).toBe(true);
		expect(shouldRunDependencyAudit(context(["go.mod"], "files"))).toBe(true);
		expect(shouldRunDependencyAudit(context(["Cargo.lock"], "files"))).toBe(true);
	});
});
