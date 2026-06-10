import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLI = path.resolve("dist/cli.js");
const PKG_VERSION = (
	JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as { version: string }
).version;

const runCli = (args: string[], cwd?: string) =>
	spawnSync(process.execPath, [CLI, ...args], {
		encoding: "utf8",
		...(cwd ? { cwd } : {}),
		env: {
			...process.env,
			AISLOP_NO_TELEMETRY: "1",
			AISLOP_NO_UPDATE_NOTIFIER: "1",
			DO_NOT_TRACK: "1",
			CI: "1",
			NO_COLOR: "1",
		},
	});

const PUBLIC_HELP_COMMANDS: string[][] = [
	["--help"],
	["scan", "--help"],
	["fix", "--help"],
	["agent", "--help"],
	["agent", "plan", "--help"],
	["agent", "providers", "--help"],
	["agent", "connect", "--help"],
	["agent", "use", "--help"],
	["agent", "switch", "--help"],
	["agent", "monitor", "--help"],
	["agent", "monitor", "list", "--help"],
	["agent", "monitor", "show", "--help"],
	["agent", "monitor", "stop", "--help"],
	["agent", "sessions", "--help"],
	["agent", "show", "--help"],
	["agent", "apply", "--help"],
	["agent", "watch", "--help"],
	["agent", "stop", "--help"],
	["ci", "--help"],
	["init", "--help"],
	["doctor", "--help"],
	["rules", "--help"],
	["hook", "--help"],
	["hooks", "--help"],
	["hook", "install", "--help"],
	["hook", "uninstall", "--help"],
	["hook", "status", "--help"],
	["hook", "baseline", "--help"],
	["install", "--help"],
	["install", "hooks", "--help"],
	["uninstall", "--help"],
	["uninstall", "hooks", "--help"],
	["badge", "--help"],
	["trend", "--help"],
	["trends", "--help"],
	["update", "--help"],
	["upgrade", "--help"],
	["version", "--help"],
	["commands", "--help"],
];

describe("cli ergonomics", () => {
	it("uses the installed command in top-level help and keeps npx for one-off latest runs", () => {
		const result = runCli(["--help"]);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("the quality gate for agentic coding");
		expect(result.stdout).not.toContain("The unified code quality CLI");
		expect(result.stdout).toContain("scan [options] [directory]");
		expect(result.stdout).toContain("Score this project and show findings");
		expect(result.stdout).toContain("aislop ci");
		expect(result.stdout).toContain("aislop agent");
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
		expect(result.stdout).toContain("Guide");
		expect(result.stdout).toContain("[directory] means a repo or path to scan");
		expect(result.stdout).toContain("Flag guide");
		expect(result.stdout).toContain("aislop [directory]");
		expect(result.stdout).toContain("aislop ci [directory]");
		expect(result.stdout).toContain("aislop agent [directory]");
		expect(result.stdout).toContain("aislop agent plan [directory]");
		expect(result.stdout).toContain("aislop agent providers");
		expect(result.stdout).toContain("aislop agent connect [provider]");
		expect(result.stdout).toContain("aislop agent switch [provider]");
		expect(result.stdout).toContain("aislop agent sessions [directory]");
		expect(result.stdout).toContain("aislop agent show [session]");
		expect(result.stdout).toContain("aislop agent apply [session]");
		expect(result.stdout).toContain("aislop agent watch [session]");
		expect(result.stdout).toContain("aislop agent monitor [directory]");
		expect(result.stdout).toContain("aislop agent monitor list [directory]");
		expect(result.stdout).toContain("aislop agent monitor show [monitor]");
		expect(result.stdout).toContain("aislop agent monitor stop [monitor]");
		expect(result.stdout).toContain("aislop agent stop [session]");
		expect(result.stdout).toContain("-d, --verbose");
		expect(result.stdout).toContain("-f, --force");
		expect(result.stdout).toContain("-p, --prompt");
		expect(result.stdout).toContain("--base <ref>");
		expect(result.stdout).toContain("--safe");
		expect(result.stdout).toContain("--deep-agents");
		expect(result.stdout).toContain("--crush");
		expect(result.stdout).toContain("aislop hooks");
		expect(result.stdout).toContain("aislop hook");
		expect(result.stdout).toContain("aislop hook uninstall");
		expect(result.stdout).toContain("aislop hook baseline");
		expect(result.stdout).toContain("aislop install [agents...]");
		expect(result.stdout).toContain("aislop uninstall [agents...]");
		expect(result.stdout).toContain("--agent <names>");
		expect(result.stdout).toContain("--quality-gate");
		expect(result.stdout).toContain("--copilot");
		expect(result.stdout).toContain("aislop badge [directory]");
		expect(result.stdout).toContain("aislop trends [directory]");
		expect(result.stdout).toContain("--owner <owner>");
		expect(result.stdout).toContain("--provider <provider>");
		expect(result.stdout).toContain("--target-score <score>");
		expect(result.stdout).toContain("--max-turns <n>");
		expect(result.stdout).toContain("--limit <n>");
		expect(result.stdout).toContain("--dry-run");
		expect(result.stdout).toContain("--no-fix");
		expect(result.stdout).toContain("--background");
		expect(result.stdout).toContain("aislop <command> --help");
		expect(result.stdout).not.toContain("--all");
	});

	it("renders help for every public command without argument-routing errors", () => {
		for (const args of PUBLIC_HELP_COMMANDS) {
			const result = runCli(args);
			const label = `aislop ${args.join(" ")}`;
			expect(result.status, label).toBe(0);
			if (args.length === 1 && args[0] === "--help") {
				expect(result.stdout, label).toContain("Usage");
			} else {
				expect(result.stdout, label).toContain("Usage:");
			}
			expect(result.stderr, label).not.toContain("too many arguments");
			expect(result.stderr, label).not.toContain("unknown command");
		}
	}, 60_000);

	it("keeps existing core command help complete and aligned with registered flags", () => {
		const scan = runCli(["scan", "--help"]);
		const fix = runCli(["fix", "--help"]);
		const ci = runCli(["ci", "--help"]);
		const init = runCli(["init", "--help"]);
		const rules = runCli(["rules", "--help"]);
		const badge = runCli(["badge", "--help"]);
		const trend = runCli(["trend", "--help"]);
		const trends = runCli(["trends", "--help"]);
		const update = runCli(["update", "--help"]);

		expect(scan.status).toBe(0);
		expect(scan.stdout).toContain("Score a project and print findings");
		expect(scan.stdout).toContain("--changes");
		expect(scan.stdout).toContain("--staged");
		expect(scan.stdout).toContain("--base <ref>");
		expect(scan.stdout).toContain("--include <patterns>");
		expect(scan.stdout).toContain("--exclude <patterns>");

		expect(fix.status).toBe(0);
		expect(fix.stdout).toContain("Auto-fix findings or hand off to a coding agent");
		expect(fix.stdout).toContain("--safe");
		expect(fix.stdout).toContain("--claude");
		expect(fix.stdout).toContain("--codex");
		expect(fix.stdout).toContain("--opencode");
		expect(fix.stdout).toContain("--crush");

		expect(ci.status).toBe(0);
		expect(ci.stdout).toContain("Run the quality gate for CI");
		expect(ci.stdout).toContain("--changes");
		expect(ci.stdout).toContain("--staged");
		expect(ci.stdout).toContain("--base <ref>");
		expect(ci.stdout).toContain("--human");
		expect(ci.stdout).toContain("--sarif");

		expect(init.status).toBe(0);
		expect(init.stdout).toContain("Create aislop config and optional CI workflow");
		expect(init.stdout).toContain("--strict");

		expect(rules.status).toBe(0);
		expect(rules.stdout).toContain("Explain rules, severity, and fix mode");
		expect(rules.stdout).toContain("--search");

		expect(badge.status).toBe(0);
		expect(badge.stdout).toContain("Print score badge URL and README markdown");
		expect(badge.stdout).toContain("--owner <owner>");
		expect(badge.stdout).toContain("--repo <repo>");
		expect(badge.stdout).toContain("--json");

		expect(trend.status).toBe(0);
		expect(trend.stdout).toContain("Show local score history");
		expect(trend.stdout).toContain("--limit <n>");

		expect(trends.status).toBe(0);
		expect(trends.stdout).toContain("Show local score history");
		expect(trends.stdout).toContain("--limit <n>");

		expect(update.status).toBe(0);
		expect(update.stdout).toContain("Check npm for the latest aislop version");
		expect(update.stdout).toContain("upgrade");
	}, 30_000);

	it("renders scan scope as an aligned display row", () => {
		const result = runCli(["scan", "--changes"]);

		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/Scope\s+\d+ changed file\(s\)/);
		expect(result.stdout).not.toContain("Scope:");
	});

	it("exposes local agent provider status and repair session help", () => {
		const help = runCli(["agent", "--help"]);
		// Run in an isolated dir so a developer's local provider preference
		// (.aislop/agent/provider.json, written by `aislop agent use`) can't make
		// this assert the wrong default.
		const providers = runCli(["agent", "providers"], mkdtempSync(path.join(tmpdir(), "aislop-")));
		const connect = runCli(["agent", "connect", "codex", "--dry-run"]);

		expect(help.status).toBe(0);
		expect(help.stdout).toContain("Run a local AI slop repair session");
		expect(help.stdout).toContain("--provider <provider>");
		expect(help.stdout).toContain("--apply");
		expect(help.stdout).toContain("--background");
		expect(help.stdout).toContain("--commit");
		expect(help.stdout).toContain("--pr");
		expect(help.stdout).toContain("--commit-message <message>");
		expect(help.stdout).toContain("--no-keep-worktree");
		expect(help.stdout).toContain("plan");
		expect(help.stdout).toContain("monitor");
		expect(help.stdout).toContain("sessions");
		expect(help.stdout).toContain("show");
		expect(help.stdout).toContain("apply");
		expect(help.stdout).toContain("watch");
		expect(help.stdout).toContain("stop");
		expect(help.stdout).toContain("use");

		expect(providers.status).toBe(0);
		expect(providers.stdout).toContain("Agent providers");
		expect(providers.stdout).toContain("Default");
		expect(providers.stdout).toMatch(/Provider\s+auto/);
		expect(providers.stdout).toContain("Codex");
		expect(providers.stdout).toContain("Claude Code");
		expect(providers.stdout).toContain("OpenCode");
		expect(providers.stdout).toContain("aislop agent connect codex");
		expect(providers.stdout).toContain("aislop agent use <provider|auto>");

		expect(connect.status).toBe(0);
		expect(connect.stdout).toContain("Agent connect");
		expect(connect.stdout).toContain("Plan");
		expect(connect.stdout).toMatch(/Provider\s+Codex/);
		expect(connect.stdout).toMatch(/Command\s+codex login/);
	}, 15_000);

	it("exposes a local default-provider switch without provider keys", () => {
		const result = runCli(["agent", "use", "codex", "--dry-run"]);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Agent provider");
		expect(result.stdout).toContain("Dry run");
		expect(result.stdout).toMatch(/Provider\s+Codex \(codex\)/);
		expect(result.stdout).toContain(".aislop/agent/provider.json");
	});

	it("exposes local monitor mode for continuous scan cycles", () => {
		const result = runCli(["agent", "monitor", "--help"]);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Watch local git changes");
		expect(result.stdout).toContain("--repair");
		expect(result.stdout).toContain("--background");
		expect(result.stdout).toContain("--interval <ms>");
		expect(result.stdout).toContain("--debounce <ms>");
		expect(result.stdout).toContain("--once");
		expect(result.stdout).toContain("--in-place");
		expect(result.stdout).toContain("list");
		expect(result.stdout).toContain("show");
		expect(result.stdout).toContain("stop");

		const list = runCli(["agent", "monitor", "list", "--help"]);
		const stop = runCli(["agent", "monitor", "stop", "--help"]);

		expect(list.status).toBe(0);
		expect(list.stdout).toContain("List local background agent monitors");
		expect(list.stdout).toContain("--limit <n>");
		expect(stop.status).toBe(0);
		expect(stop.stdout).toContain("Stop a running background agent monitor");
		expect(stop.stdout).toContain("--force");
	});

	it("exposes apply-later help for reviewed isolated worktree sessions", () => {
		const result = runCli(["agent", "apply", "--help"]);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Apply a reviewed isolated worktree session");
		expect(result.stdout).toContain("--root <directory>");
		expect(result.stdout).toContain("--dry-run");
		expect(result.stdout).toContain("-y, --yes");
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
		expect(fromHooks.stdout).toContain("Hook install");
		expect(fromAgent.stdout).toContain("Hook install");
		expect(fromHooks.stdout).toContain("dry-run");
		expect(fromAgent.stdout).toContain("dry-run");
		expect(fromHooks.stdout).toContain("claude");
		expect(fromAgent.stdout).toContain("claude");
		expect(fromHooks.stdout).toMatch(/Status\s+planned|Status\s+up to date/);
		expect(fromAgent.stdout).toMatch(/Status\s+planned|Status\s+up to date/);
		expect(fromHooks.stdout).not.toMatch(/claude\s+planned|claude\s+up to date/);
		expect(fromAgent.stdout).not.toMatch(/claude\s+planned|claude\s+up to date/);
		expect(fromHooks.stdout).not.toContain("claude:");
		expect(fromAgent.stdout).not.toContain("claude:");
	});
});
