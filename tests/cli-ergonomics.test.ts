import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLI = path.resolve("dist/cli.js");
const PKG_VERSION = (
	JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as { version: string }
).version;

const runCli = (args: string[]) =>
	spawnSync(process.execPath, [CLI, ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			AISLOP_NO_TELEMETRY: "1",
			AISLOP_NO_UPDATE_NOTIFIER: "1",
			DO_NOT_TRACK: "1",
			CI: "1",
			NO_COLOR: "1",
		},
	});

describe("cli ergonomics", () => {
	it("uses the installed command in top-level help and keeps npx for one-off latest runs", () => {
		const result = runCli(["--help"]);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("the quality gate for agentic coding");
		expect(result.stdout).not.toContain("The unified code quality CLI");
		expect(result.stdout).toContain("scan [options] [directory]");
		expect(result.stdout).toContain("Score this project and show findings");
		expect(result.stdout).toContain("aislop ci");
		expect(result.stdout).toContain("--safe");
		expect(result.stdout).toContain(".aislopignore");
		expect(result.stdout).toContain("aislop commands");
		expect(result.stdout).toContain("aislop hook install --claude");
		expect(result.stdout).toContain("aislop install hooks");
		expect(result.stdout).toContain("npx aislop@latest scan");
		expect(result.stdout).not.toContain("Run npx aislop scan");
	});

	it("treats version as a first-class command instead of a directory scan", () => {
		const result = runCli(["version"]);

		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toBe(PKG_VERSION);
		expect(result.stderr).not.toContain("Path does not exist");
	});

	it("supports the conventional -V version alias", () => {
		const result = runCli(["-V"]);

		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toBe(PKG_VERSION);
		expect(result.stderr).not.toContain("unknown option");
	});

	it("lists all commands and major flags", () => {
		const result = runCli(["commands"]);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Commands");
		expect(result.stdout).toContain("aislop ci [directory]");
		expect(result.stdout).toContain("-d, --verbose");
		expect(result.stdout).toContain("-f, --force");
		expect(result.stdout).toContain("-p, --prompt");
		expect(result.stdout).toContain("--safe");
		expect(result.stdout).toContain("--deep-agents");
		expect(result.stdout).toContain("--crush");
		expect(result.stdout).toContain("aislop hooks");
		expect(result.stdout).toContain("aislop hook uninstall");
		expect(result.stdout).toContain("aislop hook baseline");
		expect(result.stdout).toContain("aislop install [agents...]");
		expect(result.stdout).toContain("aislop uninstall [agents...]");
		expect(result.stdout).toContain("--agent <names>");
		expect(result.stdout).toContain("--quality-gate");
		expect(result.stdout).toContain("--copilot");
		expect(result.stdout).toContain("aislop badge [directory]");
		expect(result.stdout).toContain("--owner <owner>");
		expect(result.stdout).toContain("--limit <n>");
		expect(result.stdout).toContain("aislop <command> --help");
		expect(result.stdout).not.toContain("--all");
	});

	it("routes hooks as an alias for the hook command", () => {
		const result = runCli(["hooks", "--help"]);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Usage: aislop hook");
		expect(result.stdout).toContain("install");
		expect(result.stdout).toContain("status");
		expect(result.stdout).not.toContain("Internal:");
		expect(result.stdout).not.toContain("claude [options]");
	});

	it("supports the natural install hooks command form", () => {
		const result = runCli(["install", "hooks", "--help"]);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Usage: aislop install [options] [agents...]");
		expect(result.stdout).toContain("Install coding-agent hooks");
		expect(result.stdout).toContain("--claude");
		expect(result.stdout).not.toContain("[target]");
	});

	it("has an explicit update command instead of falling through to scan/menu handling", () => {
		const result = runCli(["update", "--help"]);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Check npm for the latest aislop version");
		expect(result.stdout).toContain("upgrade");
	});

	it("exposes searchable rules mode", () => {
		const result = runCli(["rules", "--help"]);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Explain rules, severity, and fix mode");
		expect(result.stdout).toContain("--search");
	});

	it("supports install hooks and install <agent> as equivalent dry-run aliases", () => {
		const fromHooks = runCli(["install", "hooks", "--claude", "--dry-run"]);
		const fromAgent = runCli(["install", "claude", "--dry-run"]);

		expect(fromHooks.status).toBe(0);
		expect(fromAgent.status).toBe(0);
		expect(fromHooks.stdout).toContain("aislop hook install (dry-run)");
		expect(fromAgent.stdout).toContain("aislop hook install (dry-run)");
		expect(fromHooks.stdout).toContain("claude:");
		expect(fromAgent.stdout).toContain("claude:");
	});
});
