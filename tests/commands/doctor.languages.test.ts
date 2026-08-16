import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doctorCommand } from "../../src/commands/doctor.js";
import { stripAnsi } from "../helpers/ansi.js";

let projectDir: string;

const writeProjectFile = (relativePath: string, content: string): void => {
	const target = path.join(projectDir, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content, "utf-8");
};

// A root package.json that pins a CLI tool but ships no JavaScript. This is the
// shape that made doctor call a C# repository a JavaScript one.
const writeToolPinManifest = (): void => {
	writeProjectFile(
		"package.json",
		`${JSON.stringify({ name: "tool-pin", devDependencies: { aislop: "0.11.0" } }, null, 2)}\n`,
	);
};

const writeCsharpProject = (): void => {
	writeProjectFile("src/App.csproj", "<Project></Project>\n");
	writeProjectFile("src/Program.cs", "class Program { static void Main() { } }\n");
};

const runDoctor = async (): Promise<string> => {
	vi.mocked(process.stdout.write).mockClear();
	await doctorCommand(projectDir, { printBrand: false });
	return stripAnsi(
		vi
			.mocked(process.stdout.write)
			.mock.calls.map(([chunk]) => String(chunk))
			.join(""),
	);
};

beforeEach(() => {
	projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-doctor-languages-"));
	// Source-file enumeration walks the git index, so the fixture needs a repo.
	execFileSync("git", ["init", "-q"], { cwd: projectDir });
	vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("doctor language detection", () => {
	it("reports csharp for a C# project whose root package.json only pins a CLI tool", async () => {
		writeToolPinManifest();
		writeCsharpProject();

		const out = await runDoctor();

		expect(out).toContain("csharp");
		expect(out).not.toContain("javascript");
		expect(out).not.toContain("biome");
		expect(out).not.toContain("oxlint");
		expect(out).not.toContain("knip");
	});

	it("plans the C# tools for a tool-pinned C# project when project evaluation is on", async () => {
		writeToolPinManifest();
		writeCsharpProject();
		writeProjectFile(".aislop/config.yml", "lint:\n  csharp:\n    projectEvaluation: true\n");

		const out = await runDoctor();

		expect(out).toContain("dotnet format whitespace");
		expect(out).toMatch(/jb inspectcode|roslynator/);
	});

	it("keeps the manifest language for a project with no source files yet", async () => {
		writeToolPinManifest();

		const out = await runDoctor();

		expect(out).toContain("javascript");
		expect(out).toContain("biome (bundled)");
	});

	it("ignores a JavaScript subtree the config excludes", async () => {
		writeCsharpProject();
		writeProjectFile("legacy/app.js", "module.exports = {};\n");
		writeProjectFile(".aislop/config.yml", "exclude:\n  - legacy/**\n");

		const out = await runDoctor();

		expect(out).toContain("csharp");
		expect(out).not.toContain("javascript");
		expect(out).not.toContain("biome");
		expect(out).not.toContain("oxlint");
	});

	it("ignores a JavaScript subtree .aislopignore excludes", async () => {
		writeCsharpProject();
		writeProjectFile("legacy/app.js", "module.exports = {};\n");
		writeProjectFile(".aislopignore", "legacy/\n");

		const out = await runDoctor();

		expect(out).toContain("csharp");
		expect(out).not.toContain("javascript");
		expect(out).not.toContain("biome");
		expect(out).not.toContain("oxlint");
	});

	// The gitignore snapshot is cached per root and only discarded at the start of a
	// run, so a long-lived caller (the interactive loop, the MCP server) classifies
	// the second run's files against it. Enumerating before the reset made a file
	// added between the two runs read as ignored.
	it("sees a source file added between two runs in the same process", async () => {
		writeToolPinManifest();
		await runDoctor();

		writeCsharpProject();
		const out = await runDoctor();

		expect(out).toContain("csharp");
	});

	// scan derives its languages from source and test files alike, so a C# project
	// whose only JavaScript is its tests still gets the JS tools there. doctor has
	// to name them or it reports tooling scan does not run.
	it("reports javascript for a C# project whose only JavaScript is its tests", async () => {
		writeCsharpProject();
		writeProjectFile("tests/app.test.js", "test('works', () => {});\n");

		const out = await runDoctor();

		expect(out).toContain("javascript");
		expect(out).toContain("biome (bundled)");
		expect(out).toContain("oxlint (bundled)");
	});
});
