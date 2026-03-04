import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverProject } from "../src/utils/discover.js";

// Helpers to create fake project directories
const createFile = (dir: string, filename: string, content = "") => {
	fs.writeFileSync(path.join(dir, filename), content, "utf-8");
};

describe("discoverProject", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "slop-discover-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// ─── rootDirectory & projectName ────────────────────────────────────────────

	it("resolves rootDirectory to an absolute path", async () => {
		const info = await discoverProject(tmpDir);
		expect(path.isAbsolute(info.rootDirectory)).toBe(true);
		expect(info.rootDirectory).toBe(path.resolve(tmpDir));
	});

	it("uses package.json name as projectName when available", async () => {
		createFile(tmpDir, "package.json", JSON.stringify({ name: "my-cool-app" }));
		const info = await discoverProject(tmpDir);
		expect(info.projectName).toBe("my-cool-app");
	});

	it("falls back to directory basename when package.json is absent", async () => {
		const info = await discoverProject(tmpDir);
		expect(info.projectName).toBe(path.basename(tmpDir));
	});

	it("falls back to directory basename when package.json has no name field", async () => {
		createFile(tmpDir, "package.json", JSON.stringify({ version: "1.0.0" }));
		const info = await discoverProject(tmpDir);
		expect(info.projectName).toBe(path.basename(tmpDir));
	});

	it("falls back to directory basename when package.json is invalid JSON", async () => {
		createFile(tmpDir, "package.json", "{ invalid }");
		const info = await discoverProject(tmpDir);
		expect(info.projectName).toBe(path.basename(tmpDir));
	});

	// ─── Language detection ──────────────────────────────────────────────────────

	it("detects typescript when tsconfig.json is present", async () => {
		createFile(tmpDir, "tsconfig.json", "{}");
		const info = await discoverProject(tmpDir);
		expect(info.languages).toContain("typescript");
	});

	it("detects javascript (not typescript) when package.json exists without tsconfig", async () => {
		createFile(tmpDir, "package.json", JSON.stringify({ name: "js-app" }));
		const info = await discoverProject(tmpDir);
		expect(info.languages).toContain("javascript");
		expect(info.languages).not.toContain("typescript");
	});

	it("detects typescript when both tsconfig.json and package.json are present", async () => {
		createFile(tmpDir, "package.json", JSON.stringify({ name: "ts-app" }));
		createFile(tmpDir, "tsconfig.json", "{}");
		const info = await discoverProject(tmpDir);
		expect(info.languages).toContain("typescript");
	});

	it("detects go when go.mod is present", async () => {
		createFile(tmpDir, "go.mod", "module example.com/app\n\ngo 1.21");
		const info = await discoverProject(tmpDir);
		expect(info.languages).toContain("go");
	});

	it("detects rust when Cargo.toml is present", async () => {
		createFile(tmpDir, "Cargo.toml", '[package]\nname = "app"');
		const info = await discoverProject(tmpDir);
		expect(info.languages).toContain("rust");
	});

	it("detects ruby when Gemfile is present", async () => {
		createFile(tmpDir, "Gemfile", "source 'https://rubygems.org'");
		const info = await discoverProject(tmpDir);
		expect(info.languages).toContain("ruby");
	});

	it("detects php when composer.json is present", async () => {
		createFile(tmpDir, "composer.json", "{}");
		const info = await discoverProject(tmpDir);
		expect(info.languages).toContain("php");
	});

	it("detects python when requirements.txt is present", async () => {
		createFile(tmpDir, "requirements.txt", "flask==2.0.0");
		const info = await discoverProject(tmpDir);
		expect(info.languages).toContain("python");
	});

	it("detects python when pyproject.toml is present", async () => {
		createFile(tmpDir, "pyproject.toml", "[tool.poetry]");
		const info = await discoverProject(tmpDir);
		expect(info.languages).toContain("python");
	});

	it("detects java when pom.xml is present", async () => {
		createFile(tmpDir, "pom.xml", "<project/>");
		const info = await discoverProject(tmpDir);
		expect(info.languages).toContain("java");
	});

	it("detects java when build.gradle is present", async () => {
		createFile(tmpDir, "build.gradle", "plugins {}");
		const info = await discoverProject(tmpDir);
		expect(info.languages).toContain("java");
	});

	it("detects multiple languages in the same project", async () => {
		createFile(tmpDir, "tsconfig.json", "{}");
		createFile(tmpDir, "go.mod", "module example.com/app\n\ngo 1.21");
		const info = await discoverProject(tmpDir);
		expect(info.languages).toContain("typescript");
		expect(info.languages).toContain("go");
	});

	it("returns empty languages array when no signals are found", async () => {
		const info = await discoverProject(tmpDir);
		expect(info.languages).toEqual([]);
	});

	// ─── Framework detection ─────────────────────────────────────────────────────

	it("detects nextjs from next.config.js", async () => {
		createFile(tmpDir, "next.config.js", "module.exports = {}");
		const info = await discoverProject(tmpDir);
		expect(info.frameworks).toContain("nextjs");
	});

	it("detects nextjs from next.config.mjs", async () => {
		createFile(tmpDir, "next.config.mjs", "export default {}");
		const info = await discoverProject(tmpDir);
		expect(info.frameworks).toContain("nextjs");
	});

	it("detects nextjs from package.json dependency", async () => {
		createFile(
			tmpDir,
			"package.json",
			JSON.stringify({ name: "app", dependencies: { next: "14.0.0" } }),
		);
		const info = await discoverProject(tmpDir);
		expect(info.frameworks).toContain("nextjs");
	});

	it("detects react from package.json dependency", async () => {
		createFile(
			tmpDir,
			"package.json",
			JSON.stringify({ name: "app", dependencies: { react: "18.0.0" } }),
		);
		const info = await discoverProject(tmpDir);
		expect(info.frameworks).toContain("react");
	});

	it("detects vite from devDependencies", async () => {
		createFile(
			tmpDir,
			"package.json",
			JSON.stringify({ name: "app", devDependencies: { vite: "5.0.0" } }),
		);
		const info = await discoverProject(tmpDir);
		expect(info.frameworks).toContain("vite");
	});

	it("detects django from requirements.txt", async () => {
		createFile(tmpDir, "requirements.txt", "Django==4.2.0\npsycopg2");
		const info = await discoverProject(tmpDir);
		expect(info.frameworks).toContain("django");
	});

	it("detects flask from requirements.txt", async () => {
		createFile(tmpDir, "requirements.txt", "Flask==2.3.0");
		const info = await discoverProject(tmpDir);
		expect(info.frameworks).toContain("flask");
	});

	it("detects fastapi from requirements.txt", async () => {
		createFile(tmpDir, "requirements.txt", "fastapi==0.100.0\nuvicorn");
		const info = await discoverProject(tmpDir);
		expect(info.frameworks).toContain("fastapi");
	});

	it("returns none when no frameworks are detected", async () => {
		const info = await discoverProject(tmpDir);
		expect(info.frameworks).toContain("none");
	});

	// ─── installedTools ──────────────────────────────────────────────────────────

	it("returns installedTools as a Record<string, boolean>", async () => {
		const info = await discoverProject(tmpDir);
		expect(typeof info.installedTools).toBe("object");
		for (const val of Object.values(info.installedTools)) {
			expect(typeof val).toBe("boolean");
		}
	});

	// ─── sourceFileCount ─────────────────────────────────────────────────────────

	it("returns sourceFileCount as a non-negative number", async () => {
		const info = await discoverProject(tmpDir);
		expect(info.sourceFileCount).toBeGreaterThanOrEqual(0);
	});
});
