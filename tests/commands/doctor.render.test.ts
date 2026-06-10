import { describe, expect, it } from "vitest";
import { buildDoctorRender, type DoctorEngineRow } from "../../src/commands/doctor.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

describe("doctor render", () => {
	it("shows each engine with its tool and an 'all ready' footer", () => {
		const rows: DoctorEngineRow[] = [
			{ engine: "Formatting", tool: "biome (bundled)", status: "ok" },
			{ engine: "Linting", tool: "oxlint (bundled)", status: "ok" },
			{ engine: "Security", tool: "pnpm audit", status: "ok" },
			{ engine: "Architecture", tool: "opt-in", status: "skipped", skipReason: "not configured" },
		];
		const out = strip(
			buildDoctorRender({
				projectName: "my-app",
				languageLabel: "typescript",
				rows,
				invocation: "aislop",
			}),
		);
		expect(out).toContain("Doctor report");
		expect(out).toContain("my-app");
		expect(out).toContain("typescript");
		expect(out).toContain("Engines");
		expect(out).toContain("✓ Formatting");
		expect(out).toMatch(/Status\s+ready/);
		expect(out).toContain("biome (bundled)");
		expect(out).toContain("· Architecture");
		expect(out).toMatch(/Reason\s+not configured/);
		expect(out).toMatch(/Ready\s+3 engines/);
		expect(out).toMatch(/Missing\s+0/);
		expect(out).toMatch(/Scan\s+aislop scan/);
		expect(out).not.toContain("◆ Formatting");
		expect(out).not.toContain("│");
		expect(out).not.toContain("└");
	});

	it("surfaces missing tools with remediation and an install hint", () => {
		const rows: DoctorEngineRow[] = [
			{ engine: "Formatting", tool: "ruff (system)", status: "ok" },
			{
				engine: "Linting",
				tool: "ruff not found",
				status: "missing",
				remediation: "Install: pipx install ruff",
			},
		];
		const out = strip(
			buildDoctorRender({
				projectName: "my-app",
				languageLabel: "python",
				rows,
				invocation: "aislop",
			}),
		);
		expect(out).toContain("✗ Linting");
		expect(out).toContain("ruff not found");
		expect(out).toMatch(/Fix\s+Install: pipx install ruff/);
		expect(out).toMatch(/Ready\s+1 engines/);
		expect(out).toMatch(/Missing\s+1/);
		expect(out).toMatch(/Action\s+Install the missing tools/);
		expect(out).toMatch(/Then\s+aislop scan/);
		expect(out).not.toContain("│");
		expect(out).not.toContain("└");
	});

	it("uses the invocation string in the next command", () => {
		const out = strip(
			buildDoctorRender({
				projectName: "my-app",
				languageLabel: "typescript",
				rows: [{ engine: "Formatting", tool: "biome (bundled)", status: "ok" }],
				invocation: "aislop",
			}),
		);
		expect(out).toMatch(/Scan\s+aislop scan/);
	});
});
