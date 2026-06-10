import { describe, expect, it } from "vitest";
import {
	renderHookBaseline,
	renderHookInstall,
	renderHookStatus,
	renderHookUninstall,
} from "../../src/commands/hook.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

describe("renderHookInstall", () => {
	it("groups dry-run install plans with aligned path and change rows", () => {
		const out = strip(
			renderHookInstall({
				dryRun: true,
				items: [
					{
						agent: "claude",
						scope: "global",
						result: {
							wrote: [],
							skipped: [],
							planned: [
								{
									path: "/tmp/settings.json",
									summary: "register PostToolUse hook",
								},
							],
						},
					},
				],
			}),
		);

		expect(out).toContain("Hook install");
		expect(out).toContain("dry-run");
		expect(out).toContain("Agents");
		expect(out).toMatch(/✓ claude/);
		expect(out).toMatch(/Status\s+planned/);
		expect(out).toMatch(/Scope\s+global/);
		expect(out).toMatch(/Path\s+\/tmp\/settings\.json/);
		expect(out).toMatch(/Change\s+register PostToolUse hook/);
		expect(out).toMatch(/Apply\s+rerun without --dry-run/);
		expect(out).not.toMatch(/claude\s+planned/);

		const lines = out.split("\n");
		const pathLine = lines.find((line) => line.includes("Path"));
		const changeLine = lines.find((line) => line.includes("Change"));
		expect(pathLine?.indexOf("/tmp/settings.json")).toBe(
			changeLine?.indexOf("register PostToolUse hook"),
		);
	});
});

describe("renderHookUninstall", () => {
	it("groups uninstall dry-run output with consistent empty-state rows", () => {
		const out = strip(
			renderHookUninstall({
				dryRun: true,
				items: [
					{
						agent: "claude",
						scope: "global",
						result: { removed: [], skipped: ["/tmp/settings.json"] },
					},
				],
			}),
		);

		expect(out).toContain("Hook uninstall");
		expect(out).toContain("dry-run");
		expect(out).toMatch(/· claude/);
		expect(out).toMatch(/Status\s+nothing installed/);
		expect(out).toMatch(/Scope\s+global/);
		expect(out).toMatch(/Skipped\s+\/tmp\/settings\.json/);
		expect(out).toMatch(/Apply\s+rerun without --dry-run/);
		expect(out).not.toContain("claude: nothing installed");
		expect(out).not.toMatch(/claude\s+nothing installed/);
	});
});

describe("renderHookStatus", () => {
	it("groups installed hook status with scope and path rows", () => {
		const out = strip(
			renderHookStatus([
				{
					agent: "claude",
					scope: "global",
					installed: true,
					paths: ["/tmp/claude-settings.json"],
				},
				{
					agent: "codex",
					scope: "project",
					installed: false,
					paths: [],
				},
			]),
		);

		expect(out).toContain("Hook status");
		expect(out).toContain("Hooks");
		expect(out).toMatch(/✓ claude/);
		expect(out).toMatch(/· codex/);
		expect(out).toMatch(/Status\s+installed/);
		expect(out).toMatch(/Status\s+not installed/);
		expect(out).toMatch(/Scope\s+global/);
		expect(out).toMatch(/Scope\s+project/);
		expect(out).toMatch(/Path\s+\/tmp\/claude-settings\.json/);
		expect(out).not.toMatch(/claude\s+installed/);
		expect(out).not.toMatch(/codex\s+not installed/);
		expect(out).not.toContain("\n\n\n");

		const lines = out.split("\n");
		const statusLine = lines.find((line) => line.includes("Status") && line.includes("installed"));
		const scopeLine = lines.find((line) => line.includes("Scope") && line.includes("global"));
		const pathLine = lines.find((line) => line.includes("Path"));
		expect(statusLine?.indexOf("installed")).toBe(scopeLine?.indexOf("global"));
		expect(scopeLine?.indexOf("global")).toBe(pathLine?.indexOf("/tmp/claude-settings.json"));
	});
});

describe("renderHookBaseline", () => {
	it("renders the captured baseline as a grouped display section", () => {
		const out = strip(
			renderHookBaseline({
				score: 100,
				fileCount: 202,
				path: "/tmp/.aislop/baseline.json",
			}),
		);

		expect(out).toContain("Hook baseline");
		expect(out).toContain("Baseline");
		expect(out).toMatch(/Score\s+100\/100/);
		expect(out).toMatch(/Files\s+202/);
		expect(out).toMatch(/Path\s+\/tmp\/\.aislop\/baseline\.json/);
		expect(out).not.toContain("baseline captured:");
	});
});
