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

// Only the fields runDependencyAudit reads; cast keeps the fixture small.
const pythonContext = (rootDirectory: string): EngineContext =>
	({
		rootDirectory,
		languages: ["python"],
		installedTools: { "pip-audit": true },
		config: { security: { auditTimeout: 1000 } },
	}) as unknown as EngineContext;

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
});
