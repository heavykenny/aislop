import { describe, expect, it } from "vitest";
import { buildFixStepNames } from "../src/commands/fix-plan.js";
import type { AislopConfig } from "../src/config/index.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { ProjectInfo } from "../src/utils/discover.js";

const makeProjectInfo = (overrides: Partial<ProjectInfo> = {}): ProjectInfo => ({
	name: "test-project",
	languages: ["typescript"],
	frameworks: ["none"],
	installedTools: {},
	sourceFileCount: 10,
	...overrides,
});

describe("buildFixStepNames", () => {
	it("includes JS/TS steps for typescript projects", () => {
		const steps = buildFixStepNames(makeProjectInfo(), DEFAULT_CONFIG, {});
		expect(steps).toContain("Unused imports");
		expect(steps).toContain("Dead code & comments");
		expect(steps).toContain("Lint fixes (js/ts)");
		expect(steps).toContain("Unused dependencies");
		expect(steps).toContain("Formatting (js/ts)");
	});

	it("includes Python steps when ruff is installed", () => {
		const steps = buildFixStepNames(
			makeProjectInfo({ languages: ["python"], installedTools: { ruff: true } }),
			DEFAULT_CONFIG,
			{},
		);
		expect(steps).toContain("Lint fixes (python)");
		expect(steps).toContain("Formatting (python)");
		expect(steps).not.toContain("Lint fixes (js/ts)");
	});

	it("skips Python lint/format when ruff is not installed", () => {
		const steps = buildFixStepNames(
			makeProjectInfo({ languages: ["python"], installedTools: {} }),
			DEFAULT_CONFIG,
			{},
		);
		expect(steps).not.toContain("Lint fixes (python)");
		expect(steps).not.toContain("Formatting (python)");
	});

	it("includes Go formatting when gofmt is installed", () => {
		const steps = buildFixStepNames(
			makeProjectInfo({ languages: ["go"], installedTools: { gofmt: true } }),
			DEFAULT_CONFIG,
			{},
		);
		expect(steps).toContain("Formatting (go)");
	});

	it("does not include force steps without force flag", () => {
		const steps = buildFixStepNames(makeProjectInfo(), DEFAULT_CONFIG, {});
		expect(steps).not.toContain("Remove unused files");
		expect(steps).not.toContain("Dependency audit fixes");
	});

	it("includes force steps with force flag", () => {
		const steps = buildFixStepNames(makeProjectInfo(), DEFAULT_CONFIG, { force: true });
		expect(steps).toContain("Remove unused files");
		expect(steps).toContain("Dependency audit fixes");
	});

	it("includes Expo step when framework is expo and force is on", () => {
		const steps = buildFixStepNames(
			makeProjectInfo({ frameworks: ["expo"] }),
			DEFAULT_CONFIG,
			{ force: true },
		);
		expect(steps).toContain("Expo dependency alignment");
	});

	it("respects disabled engines in config", () => {
		const config: AislopConfig = {
			...DEFAULT_CONFIG,
			engines: { ...DEFAULT_CONFIG.engines, lint: false, format: false },
		};
		const steps = buildFixStepNames(makeProjectInfo(), config, {});
		expect(steps).not.toContain("Lint fixes (js/ts)");
		expect(steps).not.toContain("Formatting (js/ts)");
		// ai-slop steps should still be there
		expect(steps).toContain("Unused imports");
	});

	it("returns empty array when all engines are disabled", () => {
		const config: AislopConfig = {
			...DEFAULT_CONFIG,
			engines: {
				format: false,
				lint: false,
				"code-quality": false,
				"ai-slop": false,
				architecture: false,
				security: false,
			},
		};
		const steps = buildFixStepNames(makeProjectInfo(), config, {});
		expect(steps).toHaveLength(0);
	});
});
