import { describe, expect, it } from "vitest";
import { buildDoctorRender, type DoctorEngineRow } from "../../src/commands/doctor.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI_RE, "");

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
		expect(out).toContain("doctor");
		expect(out).toContain("my-app");
		expect(out).toContain("typescript");
		expect(out).toContain("◆ Formatting");
		expect(out).toContain("biome (bundled)");
		expect(out).toContain("─ Architecture");
		expect(out).toContain("opt-in · not configured");
		expect(out).toContain("└  Ready · 3 engines · 0 missing");
		expect(out).toContain("→ Run aislop scan to check this project");
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
		expect(out).toContain("│ → Install: pipx install ruff");
		expect(out).toContain("└  Ready · 1 engines · 1 missing");
		expect(out).toContain("→ Install the missing tools, then run aislop scan");
	});

	it("uses the invocation string in hint text", () => {
		const out = strip(
			buildDoctorRender({
				projectName: "my-app",
				languageLabel: "typescript",
				rows: [{ engine: "Formatting", tool: "biome (bundled)", status: "ok" }],
				invocation: "npx aislop",
			}),
		);
		expect(out).toContain("→ Run npx aislop scan to check this project");
	});
});
