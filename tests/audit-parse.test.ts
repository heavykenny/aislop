import { describe, expect, it } from "vitest";
import { parseJsAudit } from "../src/engines/security/audit.js";

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
