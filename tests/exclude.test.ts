import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/engines/types.js";
import {
	filterExcludedDiagnostics,
	isPathExcluded,
	normalizeExcludePatterns,
} from "../src/utils/exclude.js";

const diagnostic = (filePath: string): Diagnostic => ({
	filePath,
	engine: "lint",
	rule: "dotnet/IDISP001",
	severity: "warning",
	message: "test",
	help: "",
	line: 1,
	column: 1,
	category: "C# Lint",
	fixable: false,
});

describe("normalizeExcludePatterns", () => {
	it("expands a bare directory into a recursive glob", () => {
		expect(normalizeExcludePatterns(["external/VendorLib"])).toEqual(["external/VendorLib/**"]);
	});

	it("expands a bare extension into an anywhere glob", () => {
		expect(normalizeExcludePatterns([".cs"])).toEqual(["**/*.cs"]);
	});

	it("keeps an explicit glob unchanged", () => {
		expect(normalizeExcludePatterns(["external/VendorLib/**"])).toEqual(["external/VendorLib/**"]);
	});
});

describe("isPathExcluded", () => {
	const normalized = normalizeExcludePatterns(["external/VendorLib/**", ".claude/**"]);

	it("matches a file under an excluded directory", () => {
		expect(isPathExcluded("external/VendorLib/VendorLib/JournalBrokerHost.cs", normalized)).toBe(
			true,
		);
	});

	it("matches a dotfile scratch directory", () => {
		expect(isPathExcluded(".claude/spikes/App.cs", normalized)).toBe(true);
	});

	it("does not match a first-party file", () => {
		expect(isPathExcluded("GitWizard/GitWizardReport.cs", normalized)).toBe(false);
	});

	it("returns false when there are no patterns", () => {
		expect(isPathExcluded("anything.cs", [])).toBe(false);
	});
});

describe("filterExcludedDiagnostics", () => {
	const root = "/repo";

	it("drops diagnostics under excluded paths and keeps the rest", () => {
		const diagnostics = [
			diagnostic("external/VendorLib/VendorLib/JournalBrokerHost.cs"),
			diagnostic(".claude/spikes/App.axaml.cs"),
			diagnostic("GitWizard/GitWizardReport.cs"),
		];
		const kept = filterExcludedDiagnostics(diagnostics, root, [
			"external/VendorLib/**",
			".claude/**",
		]);
		expect(kept.map((d) => d.filePath)).toEqual(["GitWizard/GitWizardReport.cs"]);
	});

	it("drops a build-backed notice pointing at an excluded project file", () => {
		const notice = diagnostic("external/VendorLib/Benchmark/Benchmark.csproj");
		const kept = filterExcludedDiagnostics([notice], root, ["external/VendorLib/**"]);
		expect(kept).toHaveLength(0);
	});

	it("normalizes absolute diagnostic paths before matching", () => {
		const kept = filterExcludedDiagnostics(
			[diagnostic("/repo/external/VendorLib/VendorLib/File.cs")],
			root,
			["external/VendorLib/**"],
		);
		expect(kept).toHaveLength(0);
	});

	it("is a no-op when no exclude patterns are configured", () => {
		const diagnostics = [diagnostic("external/VendorLib/VendorLib/File.cs")];
		expect(filterExcludedDiagnostics(diagnostics, root, undefined)).toHaveLength(1);
		expect(filterExcludedDiagnostics(diagnostics, root, [])).toHaveLength(1);
	});
});
