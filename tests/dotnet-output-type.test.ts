import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOutputTypeResolver } from "../src/engines/dotnet-output-type.js";

describe("buildOutputTypeResolver", () => {
	it("reports an Exe-output project as an exe", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ot-"));
		fs.writeFileSync(
			path.join(root, "App.csproj"),
			"<Project><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>",
		);
		const cs = path.join(root, "Program.cs");
		fs.writeFileSync(cs, "");
		const resolver = buildOutputTypeResolver(root);
		expect(resolver.isExeProject(cs)).toBe(true);
	});

	it("treats a project with no OutputType as a library", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ot-"));
		fs.writeFileSync(path.join(root, "Lib.csproj"), "<Project><PropertyGroup></PropertyGroup></Project>");
		const cs = path.join(root, "Class1.cs");
		fs.writeFileSync(cs, "");
		const resolver = buildOutputTypeResolver(root);
		expect(resolver.isExeProject(cs)).toBe(false);
	});

	it("resolves a .cs file to its nearest-ancestor project", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ot-"));
		const appDir = path.join(root, "App");
		const libDir = path.join(root, "Lib");
		fs.mkdirSync(appDir);
		fs.mkdirSync(libDir);
		fs.writeFileSync(
			path.join(appDir, "App.csproj"),
			"<Project><PropertyGroup><OutputType>WinExe</OutputType></PropertyGroup></Project>",
		);
		fs.writeFileSync(path.join(libDir, "Lib.csproj"), "<Project></Project>");
		const appCs = path.join(appDir, "Main.cs");
		const libCs = path.join(libDir, "Thing.cs");
		fs.writeFileSync(appCs, "");
		fs.writeFileSync(libCs, "");
		const resolver = buildOutputTypeResolver(root);
		expect(resolver.isExeProject(appCs)).toBe(true);
		expect(resolver.isExeProject(libCs)).toBe(false);
	});

	it("treats a file under no project as a library (default)", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ot-"));
		const cs = path.join(root, "Loose.cs");
		fs.writeFileSync(cs, "");
		const resolver = buildOutputTypeResolver(root);
		expect(resolver.isExeProject(cs)).toBe(false);
	});
});
