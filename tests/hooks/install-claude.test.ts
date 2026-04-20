import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installClaude, resolveClaudePaths } from "../../src/hooks/install/claude.js";

let home: string;

beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-home-"));
});

afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
});

describe("installClaude", () => {
	it("writes settings.json, AISLOP.md, and CLAUDE.md on fresh install", () => {
		const result = installClaude({ home });
		const paths = resolveClaudePaths(home);

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
		installClaude({ home });
		const second = installClaude({ home });
		expect(second.wrote).toHaveLength(0);
	});

	it("preserves unrelated PostToolUse hooks", () => {
		const paths = resolveClaudePaths(home);
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

		installClaude({ home });
		const after = JSON.parse(fs.readFileSync(paths.settings, "utf-8"));
		expect(after.hooks.PostToolUse).toHaveLength(2);
		const userHook = after.hooks.PostToolUse.find((g: { matcher: string }) => g.matcher === "Bash");
		expect(userHook).toBeDefined();
		expect(userHook.hooks[0].command).toBe("my-other-tool");
	});

	it("appends @AISLOP.md only once to CLAUDE.md", () => {
		installClaude({ home });
		installClaude({ home });
		const paths = resolveClaudePaths(home);
		const content = fs.readFileSync(paths.claudeMd, "utf-8");
		const matches = content.match(/@AISLOP\.md/g) ?? [];
		expect(matches).toHaveLength(1);
	});

	it("respects existing CLAUDE.md content", () => {
		const paths = resolveClaudePaths(home);
		fs.mkdirSync(path.dirname(paths.claudeMd), { recursive: true });
		fs.writeFileSync(paths.claudeMd, "# My prior rules\n\nDo not delete me.\n");

		installClaude({ home });
		const content = fs.readFileSync(paths.claudeMd, "utf-8");
		expect(content).toContain("My prior rules");
		expect(content).toContain("Do not delete me.");
		expect(content).toContain("@AISLOP.md");
	});
});
