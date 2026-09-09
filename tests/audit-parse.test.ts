import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseBunAudit, parseDotnetAudit, parseJsAudit } from "../src/engines/security/audit.js";

describe("parseJsAudit — modern vulnerabilities", () => {
	it("collapses a transitive chain to the package that carries the advisory", () => {
		const audit = JSON.stringify({
			vulnerabilities: {
				uuid: {
					name: "uuid",
					severity: "high",
					isDirect: false,
					range: "<7.0.0",
					fixAvailable: { name: "uuid", version: "7.0.0" },
					via: [
						{
							source: 1,
							name: "uuid",
							title: "Insecure randomness in uuid",
							severity: "high",
							range: "<7.0.0",
						},
					],
				},
				firebase: {
					name: "firebase",
					severity: "high",
					isDirect: true,
					range: "*",
					fixAvailable: false,
					via: ["uuid"],
				},
				"@firebase/auth": {
					name: "@firebase/auth",
					severity: "high",
					isDirect: false,
					range: "*",
					fixAvailable: false,
					via: ["firebase"],
				},
			},
		});

		const diagnostics = parseJsAudit(audit, "npm audit");

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("uuid");
		expect(diagnostics[0].rule).toBe("security/vulnerable-dependency");
	});

	// Mirrors expressjs/express: `diff` is vulnerable only by way of mocha, a devDependency.
	// A test-tooling advisory is not a defect in the code the project ships.
	const devOnlyAudit = JSON.stringify({
		vulnerabilities: {
			diff: {
				name: "diff",
				severity: "critical",
				isDirect: false,
				effects: ["mocha"],
				fixAvailable: { name: "mocha", version: "11.3.0" },
				via: [{ source: 1112706, name: "diff", title: "DoS", severity: "critical" }],
			},
		},
	});

	it("demotes a vulnerability that is only reachable through a devDependency", () => {
		const diagnostics = parseJsAudit(devOnlyAudit, "npm audit", {
			runtimeDependencies: new Set([]),
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].severity).toBe("info");
		expect(diagnostics[0].message).toContain("dev-only");
	});

	it("keeps full severity when the same chain reaches a runtime dependency", () => {
		const diagnostics = parseJsAudit(devOnlyAudit, "npm audit", {
			runtimeDependencies: new Set(["mocha"]),
		});

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].severity).toBe("error");
		expect(diagnostics[0].message).not.toContain("dev-only");
	});

	it("keeps full severity when dependency origin is unknown", () => {
		const diagnostics = parseJsAudit(devOnlyAudit, "npm audit");

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].severity).toBe("error");
	});

	it("reports every package when none carry an advisory object (no root info)", () => {
		const audit = JSON.stringify({
			vulnerabilities: {
				a: { name: "a", severity: "low", via: ["b"], fixAvailable: false, range: "*" },
				b: { name: "b", severity: "low", via: ["a"], fixAvailable: false, range: "*" },
			},
		});

		const diagnostics = parseJsAudit(audit, "npm audit");

		expect(diagnostics).toHaveLength(2);
	});

	it("keeps multiple distinct root advisories", () => {
		const audit = JSON.stringify({
			vulnerabilities: {
				uuid: {
					name: "uuid",
					severity: "high",
					via: [{ source: 1, name: "uuid", title: "x", severity: "high", range: "<7" }],
					fixAvailable: false,
					range: "<7",
				},
				lodash: {
					name: "lodash",
					severity: "critical",
					via: [{ source: 2, name: "lodash", title: "y", severity: "critical", range: "<4.17.21" }],
					fixAvailable: false,
					range: "<4.17.21",
				},
				express: {
					name: "express",
					severity: "high",
					via: ["lodash"],
					fixAvailable: false,
					range: "*",
				},
			},
		});

		const diagnostics = parseJsAudit(audit, "npm audit");

		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.map((d) => d.message).join(" ")).toContain("uuid");
		expect(diagnostics.map((d) => d.message).join(" ")).toContain("lodash");
	});

	it("ignores malformed nested audit values", () => {
		expect(parseJsAudit(JSON.stringify({ advisories: { bad: null } }), "npm audit")).toEqual([]);
		expect(
			parseJsAudit(JSON.stringify({ vulnerabilities: { bad: "not an object" } }), "npm audit"),
		).toEqual([]);
		expect(parseJsAudit(JSON.stringify({ error: "not an object" }), "npm audit")).toEqual([]);
	});

	it("does not treat arrays in via as advisory objects", () => {
		const diagnostics = parseJsAudit(
			JSON.stringify({
				vulnerabilities: {
					malformed: { severity: "high", via: [[]], fixAvailable: false },
					transitive: { severity: "low", via: ["malformed"], fixAvailable: false },
				},
			}),
			"npm audit",
		);

		expect(diagnostics).toHaveLength(2);
	});
});

describe("parseDotnetAudit - dotnet list package --vulnerable", () => {
	// Built from the platform's own separators so the fixture is a real absolute
	// path on Windows as well as POSIX.
	const rootDirectory = path.resolve("/repo");
	const projectPath = (...segments: string[]): string => path.join(rootDirectory, ...segments);

	const report = (frameworks: unknown, projectFile = projectPath("src", "App", "App.csproj")) =>
		JSON.stringify({
			version: 1,
			parameters: "--vulnerable --include-transitive",
			projects: [{ path: projectFile, frameworks }],
		});

	it("reports a vulnerable top-level package with severity and advisory", () => {
		const diagnostics = parseDotnetAudit(
			report([
				{
					framework: "net8.0",
					topLevelPackages: [
						{
							id: "Newtonsoft.Json",
							resolvedVersion: "11.0.1",
							vulnerabilities: [
								{ severity: "High", advisoryurl: "https://github.com/advisories/GHSA-xxxx" },
							],
						},
					],
				},
			]),
			rootDirectory,
		);

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].rule).toBe("security/vulnerable-dependency");
		expect(diagnostics[0].severity).toBe("error");
		expect(diagnostics[0].filePath).toBe("src/App/App.csproj");
		expect(diagnostics[0].message).toContain("Newtonsoft.Json@11.0.1");
		expect(diagnostics[0].message).toContain("high");
		expect(diagnostics[0].help).toContain("GHSA-xxxx");
		expect(diagnostics[0].detail).toBe("dotnet");
	});

	it("keeps projects that share a basename apart", () => {
		const vulnerablePackage = {
			id: "Newtonsoft.Json",
			resolvedVersion: "11.0.1",
			vulnerabilities: [{ severity: "High", advisoryurl: "https://x" }],
		};
		const frameworks = [{ framework: "net8.0", topLevelPackages: [vulnerablePackage] }];
		const diagnostics = parseDotnetAudit(
			JSON.stringify({
				version: 1,
				projects: [
					{ path: projectPath("src", "App", "App.csproj"), frameworks },
					{ path: projectPath("tools", "App", "App.csproj"), frameworks },
				],
			}),
			rootDirectory,
		);

		expect(diagnostics.map((diagnostic) => diagnostic.filePath)).toEqual([
			"src/App/App.csproj",
			"tools/App/App.csproj",
		]);
	});

	it("falls back to a wildcard project name when the report omits the path", () => {
		const diagnostics = parseDotnetAudit(
			JSON.stringify({
				version: 1,
				projects: [
					{
						frameworks: [
							{
								framework: "net8.0",
								topLevelPackages: [
									{
										id: "Newtonsoft.Json",
										resolvedVersion: "11.0.1",
										vulnerabilities: [{ severity: "High", advisoryurl: "" }],
									},
								],
							},
						],
					},
				],
			}),
			rootDirectory,
		);

		expect(diagnostics[0].filePath).toBe("*.csproj");
	});

	it("marks transitive findings and downgrades moderate to a warning", () => {
		const diagnostics = parseDotnetAudit(
			report([
				{
					framework: "net8.0",
					transitivePackages: [
						{
							id: "System.Text.Encodings.Web",
							resolvedVersion: "4.5.0",
							vulnerabilities: [{ severity: "Moderate", advisoryurl: "" }],
						},
					],
				},
			]),
			rootDirectory,
		);

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].severity).toBe("warning");
		expect(diagnostics[0].message).toContain("transitive");
	});

	it("dedupes a package that appears under multiple target frameworks", () => {
		const vulnerablePackage = {
			id: "Newtonsoft.Json",
			resolvedVersion: "11.0.1",
			vulnerabilities: [{ severity: "Critical", advisoryurl: "https://x" }],
		};
		const diagnostics = parseDotnetAudit(
			report([
				{ framework: "net8.0", topLevelPackages: [vulnerablePackage] },
				{ framework: "net10.0", topLevelPackages: [vulnerablePackage] },
			]),
			rootDirectory,
		);

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).not.toContain("advisories");
	});

	it("keeps the worst severity across target frameworks, not the first one listed", () => {
		const diagnostics = parseDotnetAudit(
			report([
				{
					framework: "net8.0",
					topLevelPackages: [
						{
							id: "System.Text.Json",
							resolvedVersion: "6.0.0",
							vulnerabilities: [{ severity: "Moderate", advisoryurl: "https://advisory/moderate" }],
						},
					],
				},
				{
					framework: "net10.0",
					topLevelPackages: [
						{
							id: "System.Text.Json",
							resolvedVersion: "8.0.1",
							vulnerabilities: [{ severity: "Critical", advisoryurl: "https://advisory/critical" }],
						},
					],
				},
			]),
			rootDirectory,
		);

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].severity).toBe("error");
		expect(diagnostics[0].message).toContain("System.Text.Json@8.0.1");
		expect(diagnostics[0].message).toContain("critical");
		expect(diagnostics[0].message).toContain("(2 advisories)");
		expect(diagnostics[0].help).toContain("https://advisory/critical");
	});

	it("returns nothing for a clean report or empty output", () => {
		expect(
			parseDotnetAudit(report([{ framework: "net8.0", topLevelPackages: [] }]), rootDirectory),
		).toEqual([]);
		expect(parseDotnetAudit("", rootDirectory)).toEqual([]);
		expect(parseDotnetAudit("not json", rootDirectory)).toEqual([]);
	});

	it("ignores malformed report collections and package entries", () => {
		expect(parseDotnetAudit(JSON.stringify({ projects: "invalid" }), rootDirectory)).toEqual([]);
		expect(
			parseDotnetAudit(
				JSON.stringify({
					projects: [{ frameworks: [{ topLevelPackages: [null, "invalid", { id: 42 }] }] }],
				}),
				rootDirectory,
			),
		).toEqual([]);
	});
});

describe("parseBunAudit", () => {
	it("returns no diagnostics for an empty audit result", () => {
		expect(parseBunAudit("{}")).toEqual([]);
	});

	it("maps package advisories to vulnerable-dependency diagnostics", () => {
		const audit = JSON.stringify({
			lodash: [
				{
					id: 1106913,
					title: "Command Injection in lodash",
					severity: "high",
					vulnerable_versions: "<4.17.21",
				},
				{
					id: 1108258,
					title: "Regular Expression Denial of Service (ReDoS) in lodash",
					severity: "moderate",
					vulnerable_versions: ">=4.0.0 <4.17.21",
				},
			],
		});

		const diagnostics = parseBunAudit(audit);

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].rule).toBe("security/vulnerable-dependency");
		expect(diagnostics[0].severity).toBe("error");
		expect(diagnostics[0].message).toContain("lodash");
		expect(diagnostics[0].message).toContain("high");
		expect(diagnostics[0].detail).toBe("bun");
	});

	it("ignores malformed advisory entries", () => {
		expect(parseBunAudit(JSON.stringify({ lodash: [null, "invalid", 1] }))).toEqual([]);
	});
});
