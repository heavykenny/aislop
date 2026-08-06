import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineContext } from "../src/engines/types.js";

const { runSubprocess } = vi.hoisted(() => ({ runSubprocess: vi.fn() }));

vi.mock("../src/utils/subprocess.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/utils/subprocess.js")>();
	return { ...actual, runSubprocess };
});

const { runDependencyAudit } = await import("../src/engines/security/audit.js");
const { runCargoAudit, runGovulncheck, runPipAudit } = await import(
	"../src/engines/security/audit-ecosystem.js"
);

const auditContext = (
	rootDirectory: string,
	languages: EngineContext["languages"],
	installedTools: EngineContext["installedTools"],
	dependencyAuditLanguages?: EngineContext["dependencyAuditLanguages"],
): EngineContext => ({
	rootDirectory,
	languages,
	dependencyAuditLanguages,
	frameworks: [],
	installedTools,
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: true, auditTimeout: 1000 },
		lint: { typecheck: false, expoDoctor: false },
	},
});

const pythonContext = (rootDirectory: string): EngineContext =>
	auditContext(rootDirectory, ["python"], { "pip-audit": true });

describe("runDependencyAudit: Python dependency-manifest gate", () => {
	let dir: string;

	beforeEach(() => {
		runSubprocess.mockReset();
		runSubprocess.mockResolvedValue({ stdout: '{"dependencies":[]}', stderr: "", exitCode: 0 });
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-audit-gate-"));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("does not run pip-audit on a source-only Python tree (no dependency manifest)", async () => {
		fs.writeFileSync(path.join(dir, "main.py"), "print('hi')\n");

		await runDependencyAudit(pythonContext(dir));

		expect(runSubprocess).not.toHaveBeenCalled();
	});

	it("runs pip-audit once a dependency manifest is present", async () => {
		fs.writeFileSync(path.join(dir, "pyproject.toml"), "[project]\nname = 'x'\n");

		await runDependencyAudit(pythonContext(dir));

		expect(runSubprocess).toHaveBeenCalledWith("pip-audit", ["--format=json"], expect.anything());
	});

	it("keys the dotnet audit to manifest-aware audit languages, not scan-scope languages", async () => {
		// A .csproj is what the NuGet audit needs; csharp may be absent from the
		// file-derived scan languages (e.g. every .cs excluded) yet present in
		// dependencyAuditLanguages from manifest-aware discovery.
		fs.writeFileSync(path.join(dir, "App.csproj"), "<Project></Project>\n");
		const context = auditContext(dir, [], { dotnet: true }, ["csharp"]);
		context.config.lint.csharp = {
			projectEvaluation: true,
			jb: true,
			roslynator: true,
			jbSeverityFloor: "WARNING",
			jbExcludeTypes: [],
		};

		await runDependencyAudit(context);

		expect(runSubprocess).toHaveBeenCalledWith(
			"dotnet",
			expect.arrayContaining(["list"]),
			expect.anything(),
		);
	});

	it("does not evaluate dotnet project files without explicit trust", async () => {
		fs.writeFileSync(path.join(dir, "App.csproj"), "<Project></Project>\n");
		const context = auditContext(dir, ["csharp"], { dotnet: true });
		context.config.lint.csharp = {
			projectEvaluation: false,
			jb: true,
			roslynator: true,
			jbSeverityFloor: "WARNING",
			jbExcludeTypes: [],
		};

		await runDependencyAudit(context);

		expect(runSubprocess).not.toHaveBeenCalled();
	});
});

describe("external ecosystem audit payloads", () => {
	beforeEach(() => {
		runSubprocess.mockReset();
	});

	it("parses valid pip, Cargo, and govuln results", async () => {
		runSubprocess
			.mockResolvedValueOnce({
				stdout: JSON.stringify({ dependencies: [{ name: "requests", vulns: [{}] }] }),
				stderr: "",
				exitCode: 1,
			})
			.mockResolvedValueOnce({
				stdout: JSON.stringify({
					vulnerabilities: { list: [{ advisory: { id: "RUSTSEC-1", title: "unsafe" } }] },
				}),
				stderr: "",
				exitCode: 1,
			})
			.mockResolvedValueOnce({
				stdout: `${JSON.stringify({ vulnerability: { id: "GO-1", details: "unsafe" } })}\n`,
				stderr: "",
				exitCode: 1,
			});

		await expect(runPipAudit("/repo", 1000)).resolves.toHaveLength(1);
		await expect(runCargoAudit("/repo", 1000)).resolves.toHaveLength(1);
		await expect(runGovulncheck("/repo", 1000)).resolves.toHaveLength(1);
	});

	it("ignores malformed top-level and nested values", async () => {
		runSubprocess
			.mockResolvedValueOnce({
				stdout: JSON.stringify({
					dependencies: [
						null,
						{ name: 42, vulns: [{}] },
						{ name: "requests", vulns: [null, [], "invalid"] },
					],
				}),
				stderr: "",
				exitCode: 1,
			})
			.mockResolvedValueOnce({
				stdout: JSON.stringify({
					vulnerabilities: { list: [null, "invalid", { advisory: [] }] },
				}),
				stderr: "",
				exitCode: 1,
			})
			.mockResolvedValueOnce({
				stdout: `[1]\n${JSON.stringify({ vulnerability: [] })}\n${JSON.stringify({ vulnerability: { id: 42 } })}\n`,
				stderr: "",
				exitCode: 1,
			});

		await expect(runPipAudit("/repo", 1000)).resolves.toEqual([]);
		await expect(runCargoAudit("/repo", 1000)).resolves.toEqual([]);
		await expect(runGovulncheck("/repo", 1000)).resolves.toEqual([]);
	});
});
