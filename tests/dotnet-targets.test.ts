import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type DotnetTargetSelection,
	findDotnetTargets,
	findJbTargets,
	hasRestoreEvidence,
	MAXIMUM_PROJECT_TARGETS,
	projectsSkippedNotice,
} from "../src/engines/dotnet-targets.js";
import type { EngineContext } from "../src/engines/types.js";

const context = (rootDirectory: string): EngineContext => ({
	rootDirectory,
	languages: ["csharp"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

// Write a .csproj plus the obj/project.assets.json a completed restore leaves behind.
const writeRestoredProject = (directory: string, name: string): string => {
	fs.mkdirSync(directory, { recursive: true });
	const csproj = path.join(directory, name);
	fs.writeFileSync(csproj, "");
	fs.mkdirSync(path.join(directory, "obj"), { recursive: true });
	fs.writeFileSync(path.join(directory, "obj", "project.assets.json"), "{}");
	return csproj;
};

// Write a .csproj with no restore evidence (a cold project).
const writeColdProject = (directory: string, name: string): string => {
	fs.mkdirSync(directory, { recursive: true });
	const csproj = path.join(directory, name);
	fs.writeFileSync(csproj, "");
	return csproj;
};

describe("hasRestoreEvidence", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-restore-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("is true when obj/project.assets.json exists beside the project", () => {
		const csproj = writeRestoredProject(tmpDir, "App.csproj");
		expect(hasRestoreEvidence(csproj, tmpDir)).toBe(true);
	});

	it("is false for a cold project", () => {
		const csproj = writeColdProject(tmpDir, "App.csproj");
		expect(hasRestoreEvidence(csproj, tmpDir)).toBe(false);
	});

	it("is true for a central artifacts/obj layout (arcade-style repos)", () => {
		// dotnet/runtime, roslyn, aspnetcore, etc. redirect intermediates via
		// Directory.Build.props to <root>/artifacts/obj/<ProjectName>/, so restore
		// evidence never appears beside the .csproj.
		const csproj = writeColdProject(path.join(tmpDir, "src", "App"), "App.csproj");
		fs.mkdirSync(path.join(tmpDir, "artifacts", "obj", "App"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, "artifacts", "obj", "App", "project.assets.json"),
			"{}",
		);
		expect(hasRestoreEvidence(csproj, tmpDir)).toBe(true);
	});

	it("does not credit another project's central artifacts entry", () => {
		const csproj = writeColdProject(path.join(tmpDir, "src", "App"), "App.csproj");
		fs.mkdirSync(path.join(tmpDir, "artifacts", "obj", "Other"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, "artifacts", "obj", "Other", "project.assets.json"),
			"{}",
		);
		expect(hasRestoreEvidence(csproj, tmpDir)).toBe(false);
	});
});

describe("findDotnetTargets", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-targets-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns an empty selection when the directory cannot be read", () => {
		const selection = findDotnetTargets(context(path.join(tmpDir, "missing")));
		expect(selection.targets).toEqual([]);
		expect(selection.coldProjects).toEqual([]);
		expect(selection.overCapProjects).toEqual([]);
	});

	it("prefers a single .sln over project files, without requiring restore evidence", () => {
		fs.writeFileSync(path.join(tmpDir, "App.sln"), "");
		writeColdProject(tmpDir, "App.csproj");
		const selection = findDotnetTargets(context(tmpDir));
		expect(selection.targets).toEqual([path.join(tmpDir, "App.sln")]);
		expect(selection.coldProjects).toEqual([]);
	});

	it("enumerates restored .csproj files when only a .slnx is present", () => {
		fs.writeFileSync(path.join(tmpDir, "App.slnx"), "");
		writeRestoredProject(path.join(tmpDir, "Core"), "Core.csproj");
		writeRestoredProject(path.join(tmpDir, "Cli"), "Cli.csproj");
		const expected = [
			path.join(tmpDir, "Cli", "Cli.csproj"),
			path.join(tmpDir, "Core", "Core.csproj"),
		].sort();
		expect(findDotnetTargets(context(tmpDir)).targets.sort()).toEqual(expected);
	});

	it("finds restored csproj files in subdirectories when no solution exists", () => {
		const csproj = writeRestoredProject(path.join(tmpDir, "src"), "App.csproj");
		expect(findDotnetTargets(context(tmpDir)).targets).toEqual([csproj]);
	});

	it("drops projects under a user-excluded path from the fallback selection", () => {
		const kept = writeRestoredProject(path.join(tmpDir, "App"), "App.csproj");
		writeRestoredProject(path.join(tmpDir, "external", "Vendor"), "Vendor.csproj");
		const cold = writeColdProject(path.join(tmpDir, "external", "Cold"), "Cold.csproj");
		const excluded = { ...context(tmpDir), excludePatterns: ["external/**"] };
		const selection = findDotnetTargets(excluded);
		// The excluded vendored projects appear in neither the analyzed targets nor
		// the cold-project accounting, so the skipped-project notice stays silent.
		expect(selection.targets).toEqual([kept]);
		expect(selection.coldProjects).not.toContain(cold);
		expect(projectsSkippedNotice(selection, tmpDir)).toHaveLength(0);
	});

	it("does not select a solution that could evaluate an excluded project", () => {
		fs.writeFileSync(path.join(tmpDir, "App.sln"), "");
		const kept = writeRestoredProject(path.join(tmpDir, "App"), "App.csproj");
		writeRestoredProject(path.join(tmpDir, "external", "Vendor"), "Vendor.csproj");
		const excluded = { ...context(tmpDir), excludePatterns: ["external/**"] };

		expect(findDotnetTargets(excluded).targets).toEqual([kept]);
	});

	it("skips bin/obj/node_modules when enumerating", () => {
		fs.mkdirSync(path.join(tmpDir, "obj"));
		fs.writeFileSync(path.join(tmpDir, "obj", "Generated.csproj"), "");
		writeRestoredProject(tmpDir, "App.csproj");
		expect(findDotnetTargets(context(tmpDir)).targets).toEqual([
			path.join(tmpDir, "App.csproj"),
		]);
	});

	it("selects a project restored into a central artifacts/obj layout", () => {
		const csproj = writeColdProject(path.join(tmpDir, "src", "Central"), "Central.csproj");
		fs.mkdirSync(path.join(tmpDir, "artifacts", "obj", "Central"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, "artifacts", "obj", "Central", "project.assets.json"),
			"{}",
		);
		const selection = findDotnetTargets(context(tmpDir));
		expect(selection.targets).toEqual([csproj]);
		expect(selection.coldProjects).toEqual([]);
	});

	it("routes cold projects to coldProjects instead of targets", () => {
		const restored = writeRestoredProject(path.join(tmpDir, "Warm"), "Warm.csproj");
		const cold = writeColdProject(path.join(tmpDir, "Cold"), "Cold.csproj");
		const selection = findDotnetTargets(context(tmpDir));
		expect(selection.targets).toEqual([restored]);
		expect(selection.coldProjects).toEqual([cold]);
		expect(selection.overCapProjects).toEqual([]);
	});

	it("caps restored projects at MAXIMUM_PROJECT_TARGETS", () => {
		const total = MAXIMUM_PROJECT_TARGETS + 2;
		for (let index = 0; index < total; index++) {
			writeRestoredProject(
				path.join(tmpDir, `Project${String(index).padStart(3, "0")}`),
				`Project${index}.csproj`,
			);
		}
		const selection = findDotnetTargets(context(tmpDir));
		expect(selection.targets).toHaveLength(MAXIMUM_PROJECT_TARGETS);
		expect(selection.overCapProjects).toHaveLength(2);
		expect(selection.coldProjects).toEqual([]);
		// The cap must not double-report a project.
		const overlap = selection.targets.filter((t) => selection.overCapProjects.includes(t));
		expect(overlap).toEqual([]);
	});
});

describe("findJbTargets", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-jb-targets-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns an empty selection when the directory cannot be read", () => {
		expect(findJbTargets(context(path.join(tmpDir, "missing"))).targets).toEqual([]);
	});

	it("prefers a single .slnx solution over project files (jb loads .slnx natively)", () => {
		fs.writeFileSync(path.join(tmpDir, "App.slnx"), "");
		writeRestoredProject(path.join(tmpDir, "Core"), "Core.csproj");
		expect(findJbTargets(context(tmpDir)).targets).toEqual([path.join(tmpDir, "App.slnx")]);
	});

	it("prefers a .sln over a .slnx when both are present", () => {
		fs.writeFileSync(path.join(tmpDir, "App.sln"), "");
		fs.writeFileSync(path.join(tmpDir, "App.slnx"), "");
		expect(findJbTargets(context(tmpDir)).targets).toEqual([path.join(tmpDir, "App.sln")]);
	});

	it("falls back to restored .csproj files when no solution file exists", () => {
		const csproj = writeRestoredProject(path.join(tmpDir, "src"), "App.csproj");
		expect(findJbTargets(context(tmpDir)).targets).toEqual([csproj]);
	});

	it("gates the .csproj fallback on restore evidence", () => {
		const cold = writeColdProject(path.join(tmpDir, "src"), "App.csproj");
		const selection = findJbTargets(context(tmpDir));
		expect(selection.targets).toEqual([]);
		expect(selection.coldProjects).toEqual([cold]);
	});
});

describe("projectsSkippedNotice", () => {
	const root = path.join(path.sep, "repo");

	it("returns [] when nothing was skipped", () => {
		const selection: DotnetTargetSelection = {
			targets: [path.join(root, "App.csproj")],
			coldProjects: [],
			overCapProjects: [],
		};
		expect(projectsSkippedNotice(selection, root)).toEqual([]);
	});

	it("emits one info diagnostic for cold projects", () => {
		const selection: DotnetTargetSelection = {
			targets: [],
			coldProjects: [path.join(root, "src", "Cold.csproj"), path.join(root, "Other.csproj")],
			overCapProjects: [],
		};
		const notice = projectsSkippedNotice(selection, root);
		expect(notice).toHaveLength(1);
		expect(notice[0].rule).toBe("dotnet/projects-skipped");
		expect(notice[0].severity).toBe("info");
		expect(notice[0].engine).toBe("lint");
		expect(notice[0].category).toBe("C# Lint");
		expect(notice[0].message).toContain("2");
		expect(notice[0].message).toContain("project.assets.json");
		// POSIX separators on every OS.
		expect(notice[0].filePath).toBe("src/Cold.csproj");
	});

	it("mentions the project cap when restored projects were dropped", () => {
		const overCap = [path.join(root, "Extra.csproj")];
		const notice = projectsSkippedNotice(
			{ targets: [path.join(root, "App.csproj")], coldProjects: [], overCapProjects: overCap },
			root,
		);
		expect(notice).toHaveLength(1);
		expect(notice[0].message).toContain(String(MAXIMUM_PROJECT_TARGETS));
	});
});

describe("dotnet target discovery honors .gitignore", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-gitignore-"));
		execFileSync("git", ["init", "-q"], { cwd: tmpDir, stdio: "ignore" });
		fs.writeFileSync(path.join(tmpDir, ".gitignore"), "ignored/\n");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("skips a .csproj under a gitignored directory", () => {
		writeRestoredProject(tmpDir, "App.csproj");
		fs.mkdirSync(path.join(tmpDir, "ignored"));
		fs.writeFileSync(path.join(tmpDir, "ignored", "Spike.csproj"), "");
		expect(findDotnetTargets(context(tmpDir)).targets).toEqual([
			path.join(tmpDir, "App.csproj"),
		]);
	});
});
