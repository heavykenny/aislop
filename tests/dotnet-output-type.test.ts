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

	it("treats a Sdk.Web project with no OutputType as an exe", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ot-"));
		fs.writeFileSync(
			path.join(root, "App.csproj"),
			'<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup></PropertyGroup></Project>',
		);
		const cs = path.join(root, "Program.cs");
		fs.writeFileSync(cs, "");
		const resolver = buildOutputTypeResolver(root);
		expect(resolver.isExeProject(cs)).toBe(true);
	});

	it("treats a Sdk.Worker project with no OutputType as an exe", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ot-"));
		fs.writeFileSync(
			path.join(root, "Service.csproj"),
			'<Project Sdk="Microsoft.NET.Sdk.Worker"><PropertyGroup></PropertyGroup></Project>',
		);
		const cs = path.join(root, "Program.cs");
		fs.writeFileSync(cs, "");
		const resolver = buildOutputTypeResolver(root);
		expect(resolver.isExeProject(cs)).toBe(true);
	});

	it("treats a Sdk.BlazorWebAssembly project with no OutputType as an exe", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ot-"));
		fs.writeFileSync(
			path.join(root, "Client.csproj"),
			'<Project Sdk="Microsoft.NET.Sdk.BlazorWebAssembly"><PropertyGroup></PropertyGroup></Project>',
		);
		const cs = path.join(root, "Program.cs");
		fs.writeFileSync(cs, "");
		const resolver = buildOutputTypeResolver(root);
		expect(resolver.isExeProject(cs)).toBe(true);
	});

	it("treats a plain Sdk project with no OutputType as a library", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ot-"));
		fs.writeFileSync(
			path.join(root, "Lib.csproj"),
			'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup></PropertyGroup></Project>',
		);
		const cs = path.join(root, "Class1.cs");
		fs.writeFileSync(cs, "");
		const resolver = buildOutputTypeResolver(root);
		expect(resolver.isExeProject(cs)).toBe(false);
	});

	it("lets an explicit OutputType override the Sdk.Web default", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ot-"));
		fs.writeFileSync(
			path.join(root, "Lib.csproj"),
			'<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><OutputType>Library</OutputType></PropertyGroup></Project>',
		);
		const cs = path.join(root, "Class1.cs");
		fs.writeFileSync(cs, "");
		const resolver = buildOutputTypeResolver(root);
		expect(resolver.isExeProject(cs)).toBe(false);
	});

	it("matches the Sdk attribute case-insensitively and ignores a version suffix", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ot-"));
		fs.writeFileSync(
			path.join(root, "App.csproj"),
			'<Project Sdk="MICROSOFT.NET.SDK.WEB/8.0.100"><PropertyGroup></PropertyGroup></Project>',
		);
		const cs = path.join(root, "Program.cs");
		fs.writeFileSync(cs, "");
		const resolver = buildOutputTypeResolver(root);
		expect(resolver.isExeProject(cs)).toBe(true);
	});
});
