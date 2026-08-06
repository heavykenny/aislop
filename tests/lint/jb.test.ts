import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintEngine } from "../../src/engines/lint/index.js";
import {
	buildJbProjectScope,
	parseJbXml,
	resolveCsharpLintConfig,
	runJbLint,
} from "../../src/engines/lint/jb.js";
import type { EngineContext } from "../../src/engines/types.js";

const fixture = (): string =>
	fs.readFileSync(path.join(__dirname, "../fixtures/dotnet/jb-output.xml"), "utf-8");

const opts = (
	over: Partial<{
		excludeTypes: Set<string>;
		severityFloor: "ERROR" | "WARNING" | "SUGGESTION" | "HINT";
	}> = {},
) => ({
	csharp: {
		excludeTypes: over.excludeTypes ?? new Set<string>(),
		severityFloor: over.severityFloor ?? ("WARNING" as const),
	},
	cpp: {
		excludeTypes: new Set<string>(),
		severityFloor: "WARNING" as const,
	},
});

describe("parseJbXml", () => {
	it("maps issues to aislop Diagnostic[] with jb/<TypeId> rules", () => {
		const diags = parseJbXml(fixture(), "/repo", opts());
		const redundant = diags.find((d) => d.rule === "jb/RedundantUsingDirective");
		expect(redundant).toBeDefined();
		expect(redundant?.engine).toBe("lint");
		expect(redundant?.category).toBe("C# Lint");
		expect(redundant?.severity).toBe("warning");
		expect(redundant?.line).toBe(3);
		expect(redundant?.fixable).toBe(false);
	});

	it("normalizes backslash file paths to forward slashes", () => {
		const diags = parseJbXml(fixture(), "/repo", opts());
		expect(diags[0].filePath).toBe("src/App/Service.cs");
	});

	it("drops issues below the severity floor (WARNING floor hides SUGGESTION/HINT)", () => {
		const diags = parseJbXml(fixture(), "/repo", opts());
		expect(diags.some((d) => d.rule === "jb/ConvertToConstant.Local")).toBe(false);
		expect(diags.some((d) => d.rule === "jb/RedundantToStringCall")).toBe(false);
	});

	it("includes SUGGESTION when the floor is lowered, mapped to info severity", () => {
		const diags = parseJbXml(fixture(), "/repo", opts({ severityFloor: "SUGGESTION" }));
		const suggestion = diags.find((d) => d.rule === "jb/ConvertToConstant.Local");
		expect(suggestion).toBeDefined();
		expect(suggestion?.severity).toBe("info");
	});

	it("excludes denylisted inspection types", () => {
		const diags = parseJbXml(
			fixture(),
			"/repo",
			opts({ excludeTypes: new Set(["InconsistentNaming"]) }),
		);
		expect(diags.some((d) => d.rule === "jb/InconsistentNaming")).toBe(false);
	});

	it("returns [] on malformed XML", () => {
		expect(parseJbXml("<not-xml", "/repo", opts())).toEqual([]);
	});

	it("labels C# TypeIds as C# Lint and Cpp TypeIds as C++ Lint", () => {
		const xml = `
<IssueTypes>
  <IssueType Id="CS0168" Severity="WARNING" />
  <IssueType Id="CppCStyleCast" Severity="WARNING" />
</IssueTypes>
<Issues>
  <Issue TypeId="CS0168" File="src/Foo.cs" Line="10" Message="unused var" />
  <Issue TypeId="CppCStyleCast" File="src/Foo.cpp" Line="20" Message="c-style cast" />
</Issues>`;
		const diags = parseJbXml(xml, "/repo", opts());
		const cs = diags.find((d) => d.rule === "jb/CS0168");
		const cpp = diags.find((d) => d.rule === "jb/CppCStyleCast");
		expect(cs).toBeDefined();
		expect(cs?.category).toBe("C# Lint");
		expect(cpp).toBeDefined();
		expect(cpp?.category).toBe("C++ Lint");
	});
});

describe("buildJbProjectScope", () => {
	it("joins both non-empty project scopes with a semicolon", () => {
		expect(buildJbProjectScope("A;B", "N")).toBe("A;B;N");
	});

	it("returns the cpp scope when csharp is undefined", () => {
		expect(buildJbProjectScope(undefined, "N")).toBe("N");
	});

	it("returns undefined when both are undefined", () => {
		expect(buildJbProjectScope(undefined, undefined)).toBeUndefined();
	});
});

const ctx = (rootDirectory: string): EngineContext => ({
	rootDirectory,
	languages: ["csharp"],
	frameworks: [],
	installedTools: { jb: true },
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false, expoDoctor: false },
	},
});

describe("runJbLint gating", () => {
	it("returns [] when there is no .sln/.csproj target", async () => {
		expect(
			await runJbLint(ctx("/nonexistent-xyz"), { includeCsharp: true, includeCpp: false }),
		).toEqual([]);
	});
});

describe("runJbLint restore-evidence gating", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-jb-gate-"));
		fs.writeFileSync(path.join(tmpDir, "Cold.csproj"), "");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("emits the skip notice instead of inspecting a cold project", async () => {
		const diags = await runJbLint(ctx(tmpDir), { includeCsharp: true, includeCpp: false });
		expect(diags).toHaveLength(1);
		expect(diags[0].rule).toBe("dotnet/projects-skipped");
		expect(diags[0].severity).toBe("info");
	});

	it("stays silent about C# projects when only C++ inspection was requested", async () => {
		const diags = await runJbLint(ctx(tmpDir), { includeCsharp: false, includeCpp: true });
		expect(diags).toEqual([]);
	});
});

describe("resolveCsharpLintConfig", () => {
	it("falls back to safe defaults when config.lint.csharp is absent", () => {
		const cfg = resolveCsharpLintConfig(ctx("/x"));
		expect(cfg).toEqual({
			projectEvaluation: false,
			jb: true,
			roslynator: true,
			jbSeverityFloor: "WARNING",
			jbExcludeTypes: ["InconsistentNaming"],
		});
	});
});

const ctxTools = (installedTools: Record<string, boolean>): EngineContext => ({
	...ctx("/nonexistent-csharp"),
	installedTools,
});

describe("lintEngine C# selection", () => {
	it("skips C# entirely when neither jb nor roslynator is installed", async () => {
		const result = await lintEngine.run(ctxTools({ jb: false, roslynator: false }));
		expect(result.skipped).toBe(true);
	});

	it("does not crash and yields [] when jb is installed but no target exists", async () => {
		const result = await lintEngine.run(ctxTools({ jb: true, roslynator: false }));
		expect(result.diagnostics).toEqual([]);
	});

	it("respects config.lint.csharp.jb=false (no jb pass attempted)", async () => {
		const base = ctxTools({ jb: true, roslynator: true });
		const result = await lintEngine.run({
			...base,
			config: {
				...base.config,
				lint: {
					...base.config.lint,
					csharp: { jb: false, roslynator: false, jbSeverityFloor: "WARNING", jbExcludeTypes: [] },
				},
			},
		});
		expect(result.skipped).toBe(true); // both passes disabled -> no promises -> skipped
	});
});
