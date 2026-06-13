import { describe, expect, it } from "vitest";
import { shouldRunDependencyAudit } from "../src/engines/security/audit.js";
import type { EngineContext } from "../src/engines/types.js";

const context = (files?: string[]): EngineContext => ({
	rootDirectory: "/repo",
	languages: ["typescript", "python", "go", "rust"],
	frameworks: [],
	...(files === undefined ? {} : { files }),
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: true, auditTimeout: 25000 },
		lint: { typecheck: false, expoDoctor: false },
	},
});

describe("dependency audit scope", () => {
	it("runs for full-project scans", () => {
		expect(shouldRunDependencyAudit(context())).toBe(true);
	});

	it("skips scoped scans when no dependency manifest or lockfile is in scope", () => {
		expect(shouldRunDependencyAudit(context(["src/index.ts", "tests/secrets.test.ts"]))).toBe(
			false,
		);
	});

	it("runs scoped scans when dependency inputs are in scope", () => {
		expect(shouldRunDependencyAudit(context(["package.json"]))).toBe(true);
		expect(shouldRunDependencyAudit(context(["pnpm-lock.yaml"]))).toBe(true);
		expect(shouldRunDependencyAudit(context(["pyproject.toml"]))).toBe(true);
		expect(shouldRunDependencyAudit(context(["go.mod"]))).toBe(true);
		expect(shouldRunDependencyAudit(context(["Cargo.lock"]))).toBe(true);
	});
});
