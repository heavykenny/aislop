import { describe, expect, it } from "vitest";
import { parseBunAudit, parseJsAudit } from "../src/engines/security/audit.js";

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
});
