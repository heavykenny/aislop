import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installCursor, resolveCursorPaths, uninstallCursor } from "../../src/hooks/install/cursor.js";

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

describe("installCursor global", () => {
	it("writes afterFileEdit hook to ~/.cursor/hooks.json", () => {
		const opts = { home, cwd, scope: "global" as const };
		const result = installCursor(opts);
		const paths = resolveCursorPaths(opts);
		expect(result.wrote).toContain(paths.hooks);
		const parsed = JSON.parse(fs.readFileSync(paths.hooks, "utf-8"));
		expect(parsed.version).toBe(1);
		expect(parsed.hooks.afterFileEdit).toHaveLength(1);
		expect(parsed.hooks.afterFileEdit[0].command).toBe("aislop hook cursor");
		expect(parsed.hooks.afterFileEdit[0].__aislop.managed).toBe(true);
	});

	it("is idempotent", () => {
		const opts = { home, cwd, scope: "global" as const };
		installCursor(opts);
		const second = installCursor(opts);
		expect(second.wrote).toHaveLength(0);
	});
});

describe("installCursor project", () => {
	it("writes hooks.json and .cursor/rules/aislop.mdc", () => {
		const opts = { home, cwd, scope: "project" as const };
		const result = installCursor(opts);
		const paths = resolveCursorPaths(opts);
		expect(result.wrote).toContain(paths.hooks);
		expect(result.wrote).toContain(paths.rules);
		expect(fs.existsSync(paths.rules)).toBe(true);
	});
});

describe("uninstallCursor", () => {
	it("removes the afterFileEdit hook", () => {
		const opts = { home, cwd, scope: "global" as const };
		installCursor(opts);
		uninstallCursor(opts);
		const paths = resolveCursorPaths(opts);
		expect(fs.existsSync(paths.hooks)).toBe(false);
	});

	it("preserves unrelated afterFileEdit hooks", () => {
		const opts = { home, cwd, scope: "global" as const };
		const paths = resolveCursorPaths(opts);
		fs.mkdirSync(path.dirname(paths.hooks), { recursive: true });
		fs.writeFileSync(
			paths.hooks,
			JSON.stringify(
				{
					version: 1,
					hooks: {
						afterFileEdit: [{ command: "my-other-tool", type: "command" }],
					},
				},
				null,
				2,
			),
		);
		installCursor(opts);
		uninstallCursor(opts);
		const after = JSON.parse(fs.readFileSync(paths.hooks, "utf-8"));
		expect(after.hooks.afterFileEdit).toHaveLength(1);
		expect(after.hooks.afterFileEdit[0].command).toBe("my-other-tool");
	});
});
