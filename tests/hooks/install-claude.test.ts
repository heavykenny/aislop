import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	installClaude,
	resolveClaudePaths,
	uninstallClaude,
} from "../../src/hooks/install/claude.js";

let home: string;
let cwd: string;

beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-home-"));
	cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-cwd-"));
});

afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
	fs.rmSync(cwd, { recursive: true, force: true });
});

const globalOpts = () => ({ home, cwd, scope: "global" as const });
const projectOpts = () => ({ home, cwd, scope: "project" as const });

describe("installClaude global", () => {
	it("writes settings.json, AISLOP.md, and CLAUDE.md on fresh install", () => {
		const result = installClaude(globalOpts());
		const paths = resolveClaudePaths(globalOpts());

		expect(result.wrote).toContain(paths.settings);
		expect(result.wrote).toContain(paths.aislopMd);
		expect(result.wrote).toContain(paths.claudeMd);

		const settings = JSON.parse(fs.readFileSync(paths.settings, "utf-8"));
		expect(settings.hooks.PostToolUse).toHaveLength(1);
		expect(settings.hooks.PostToolUse[0].matcher).toBe("Edit|Write|MultiEdit");
		expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe("aislop hook claude");
		expect(settings.hooks.PostToolUse[0].hooks[0].__aislop.managed).toBe(true);

		const md = fs.readFileSync(paths.aislopMd, "utf-8");
		expect(md).toContain("<!-- aislop:begin v1");
		expect(md).toContain("<!-- aislop:end v1 -->");

		const claudeMd = fs.readFileSync(paths.claudeMd, "utf-8");
		expect(claudeMd).toContain("@AISLOP.md");
	});

	it("is idempotent across repeated runs", () => {
		installClaude(globalOpts());
		const second = installClaude(globalOpts());
		expect(second.wrote).toHaveLength(0);
	});

	it("preserves unrelated PostToolUse hooks", () => {
		const paths = resolveClaudePaths(globalOpts());
		fs.mkdirSync(path.dirname(paths.settings), { recursive: true });
		const userSettings = {
			hooks: {
				PostToolUse: [
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "my-other-tool" }],
					},
				],
			},
		};
		fs.writeFileSync(paths.settings, `${JSON.stringify(userSettings, null, 2)}\n`);

		installClaude(globalOpts());
		const after = JSON.parse(fs.readFileSync(paths.settings, "utf-8"));
		expect(after.hooks.PostToolUse).toHaveLength(2);
		const userHook = after.hooks.PostToolUse.find((g: { matcher: string }) => g.matcher === "Bash");
		expect(userHook).toBeDefined();
		expect(userHook.hooks[0].command).toBe("my-other-tool");
	});

	it("appends @AISLOP.md only once to CLAUDE.md", () => {
		installClaude(globalOpts());
		installClaude(globalOpts());
		const paths = resolveClaudePaths(globalOpts());
		const content = fs.readFileSync(paths.claudeMd, "utf-8");
		const matches = content.match(/@AISLOP\.md/g) ?? [];
		expect(matches).toHaveLength(1);
	});

	it("respects existing CLAUDE.md content", () => {
		const paths = resolveClaudePaths(globalOpts());
		fs.mkdirSync(path.dirname(paths.claudeMd), { recursive: true });
		fs.writeFileSync(paths.claudeMd, "# My prior rules\n\nDo not delete me.\n");

		installClaude(globalOpts());
		const content = fs.readFileSync(paths.claudeMd, "utf-8");
		expect(content).toContain("My prior rules");
		expect(content).toContain("Do not delete me.");
		expect(content).toContain("@AISLOP.md");
	});
});

describe("installClaude project scope", () => {
	it("writes to .claude/ inside cwd", () => {
		const result = installClaude(projectOpts());
		const paths = resolveClaudePaths(projectOpts());
		expect(paths.settings.startsWith(path.join(cwd, ".claude"))).toBe(true);
		expect(result.wrote).toContain(paths.settings);
	});
});

describe("installClaude dry-run", () => {
	it("records planned writes without touching disk", () => {
		const result = installClaude({ ...globalOpts(), dryRun: true });
		expect(result.wrote).toHaveLength(0);
		expect(result.planned.length).toBeGreaterThan(0);
		const paths = resolveClaudePaths(globalOpts());
		expect(fs.existsSync(paths.settings)).toBe(false);
	});
});

describe("installClaude quality gate", () => {
	it("adds a Stop hook when qualityGate=true", () => {
		installClaude({ ...globalOpts(), qualityGate: true });
		const paths = resolveClaudePaths(globalOpts());
		const settings = JSON.parse(fs.readFileSync(paths.settings, "utf-8"));
		expect(settings.hooks.Stop).toHaveLength(1);
		expect(settings.hooks.Stop[0].hooks[0].command).toBe("aislop hook claude --stop");
	});

	it("removes the Stop hook when qualityGate is disabled on reinstall", () => {
		installClaude({ ...globalOpts(), qualityGate: true });
		installClaude(globalOpts());
		const paths = resolveClaudePaths(globalOpts());
		const settings = JSON.parse(fs.readFileSync(paths.settings, "utf-8"));
		expect(settings.hooks.Stop).toBeUndefined();
	});
});

describe("uninstallClaude", () => {
	it("removes PostToolUse hook and deletes AISLOP.md", () => {
		installClaude(globalOpts());
		const result = uninstallClaude(globalOpts());
		const paths = resolveClaudePaths(globalOpts());
		expect(fs.existsSync(paths.aislopMd)).toBe(false);
		expect(result.removed).toContain(paths.aislopMd);
		// settings.json becomes empty after the aislop entry is removed → file is deleted per spec
		expect(fs.existsSync(paths.settings)).toBe(false);
		expect(result.removed).toContain(paths.settings);
	});

	it("preserves unrelated PostToolUse hooks during uninstall", () => {
		const paths = resolveClaudePaths(globalOpts());
		installClaude(globalOpts());
		const current = JSON.parse(fs.readFileSync(paths.settings, "utf-8"));
		current.hooks.PostToolUse.push({
			matcher: "Bash",
			hooks: [{ type: "command", command: "my-other-tool" }],
		});
		fs.writeFileSync(paths.settings, `${JSON.stringify(current, null, 2)}\n`);

		uninstallClaude(globalOpts());
		const after = JSON.parse(fs.readFileSync(paths.settings, "utf-8"));
		expect(after.hooks.PostToolUse).toHaveLength(1);
		expect(after.hooks.PostToolUse[0].matcher).toBe("Bash");
	});

	it("removes @AISLOP.md from CLAUDE.md while preserving user content", () => {
		const paths = resolveClaudePaths(globalOpts());
		fs.mkdirSync(path.dirname(paths.claudeMd), { recursive: true });
		fs.writeFileSync(paths.claudeMd, "# My rules\n\nKeep me.\n");
		installClaude(globalOpts());
		uninstallClaude(globalOpts());
		const content = fs.readFileSync(paths.claudeMd, "utf-8");
		expect(content).toContain("My rules");
		expect(content).toContain("Keep me.");
		expect(content).not.toContain("@AISLOP.md");
	});
});
