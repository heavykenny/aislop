import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAntigravity, uninstallAntigravity } from "../../src/hooks/install/antigravity.js";
import { installCline, uninstallCline } from "../../src/hooks/install/cline.js";
import { installCodex, resolveCodexPaths, uninstallCodex } from "../../src/hooks/install/codex.js";
import {
	installCopilot,
	resolveCopilotPaths,
	uninstallCopilot,
} from "../../src/hooks/install/copilot.js";
import { installKilocode, uninstallKilocode } from "../../src/hooks/install/kilocode.js";
import { installWindsurf, uninstallWindsurf } from "../../src/hooks/install/windsurf.js";

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

describe("installCodex", () => {
	it("writes ~/.codex/AGENTS.md globally", () => {
		const opts = { home, cwd, scope: "global" as const };
		installCodex(opts);
		const p = resolveCodexPaths(opts).rules;
		expect(fs.existsSync(p)).toBe(true);
		expect(fs.readFileSync(p, "utf-8")).toContain("<!-- aislop:begin");
	});

	it("writes cwd/AGENTS.md when project scope", () => {
		const opts = { home, cwd, scope: "project" as const };
		installCodex(opts);
		const p = resolveCodexPaths(opts).rules;
		expect(p).toBe(path.join(cwd, "AGENTS.md"));
		expect(fs.existsSync(p)).toBe(true);
	});
});

describe("P3 project-only installers", () => {
	it("Windsurf writes .windsurfrules in project scope", () => {
		installWindsurf({ home, cwd, scope: "project" });
		expect(fs.existsSync(path.join(cwd, ".windsurfrules"))).toBe(true);
	});

	it("Windsurf refuses global scope", () => {
		const result = installWindsurf({ home, cwd, scope: "global" });
		expect(result.wrote).toHaveLength(0);
		expect(result.planned[0].summary).toContain("--project");
	});

	it("Cline writes .clinerules and .roo/rules/aislop.md", () => {
		const result = installCline({ home, cwd, scope: "project" });
		expect(fs.existsSync(path.join(cwd, ".clinerules"))).toBe(true);
		expect(fs.existsSync(path.join(cwd, ".roo", "rules", "aislop.md"))).toBe(true);
		expect(result.wrote).toHaveLength(2);
	});

	it("Kilocode writes .kilocode/rules/aislop-rules.md", () => {
		installKilocode({ home, cwd, scope: "project" });
		expect(fs.existsSync(path.join(cwd, ".kilocode", "rules", "aislop-rules.md"))).toBe(true);
	});

	it("Antigravity writes .agents/rules/antigravity-aislop-rules.md", () => {
		installAntigravity({ home, cwd, scope: "project" });
		expect(fs.existsSync(path.join(cwd, ".agents", "rules", "antigravity-aislop-rules.md"))).toBe(
			true,
		);
	});

	it("Copilot writes .github/copilot-instructions.md", () => {
		const result = installCopilot({ home, cwd, scope: "project" });
		const p = resolveCopilotPaths({ home, cwd, scope: "project" }).rules;
		expect(fs.existsSync(p)).toBe(true);
		expect(result.wrote).toContain(p);
	});
});

describe("rules-only uninstall reversibility", () => {
	it("uninstallCodex removes the AGENTS.md it wrote", () => {
		const opts = { home, cwd, scope: "global" as const };
		installCodex(opts);
		uninstallCodex(opts);
		expect(fs.existsSync(resolveCodexPaths(opts).rules)).toBe(false);
	});

	it("uninstallWindsurf removes .windsurfrules", () => {
		const opts = { home, cwd, scope: "project" as const };
		installWindsurf(opts);
		uninstallWindsurf(opts);
		expect(fs.existsSync(path.join(cwd, ".windsurfrules"))).toBe(false);
	});

	it("uninstallCline removes both .clinerules and .roo rules", () => {
		const opts = { home, cwd, scope: "project" as const };
		installCline(opts);
		uninstallCline(opts);
		expect(fs.existsSync(path.join(cwd, ".clinerules"))).toBe(false);
		expect(fs.existsSync(path.join(cwd, ".roo", "rules", "aislop.md"))).toBe(false);
	});

	it("uninstallKilocode removes the rules file", () => {
		const opts = { home, cwd, scope: "project" as const };
		installKilocode(opts);
		uninstallKilocode(opts);
		expect(fs.existsSync(path.join(cwd, ".kilocode", "rules", "aislop-rules.md"))).toBe(false);
	});

	it("uninstallAntigravity removes the rules file", () => {
		const opts = { home, cwd, scope: "project" as const };
		installAntigravity(opts);
		uninstallAntigravity(opts);
		expect(fs.existsSync(path.join(cwd, ".agents", "rules", "antigravity-aislop-rules.md"))).toBe(
			false,
		);
	});

	it("uninstallCopilot removes .github/copilot-instructions.md", () => {
		const opts = { home, cwd, scope: "project" as const };
		installCopilot(opts);
		uninstallCopilot(opts);
		expect(fs.existsSync(resolveCopilotPaths(opts).rules)).toBe(false);
	});

	it("installers are idempotent — second run writes nothing", () => {
		const opts = { home, cwd, scope: "project" as const };
		installWindsurf(opts);
		const second = installWindsurf(opts);
		expect(second.wrote).toHaveLength(0);
	});
});
