import { describe, expect, it } from "vitest";
import { renderCommandReference, renderHome, renderRootHelp } from "../../src/ui/home.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

describe("home", () => {
	it("renders a compact command home screen", () => {
		const out = strip(renderHome({ version: "1.2.3" }));

		expect(out).toContain("aislop 1.2.3");
		expect(out).toContain("aislop scan");
		expect(out).toContain("Score this project and show findings");
		expect(out).toContain("aislop ci");
		expect(out).toContain("aislop hook install");
		expect(out).not.toContain("Usage:");
	});

	it("renders root help with usage, options, and one-off npx wording", () => {
		const out = strip(renderRootHelp({ version: "1.2.3" }));

		expect(out).toContain("Usage");
		expect(out).toContain("aislop scan [options] [directory]");
		expect(out).toContain("aislop ci [options] [directory]");
		expect(out).toContain("--changes");
		expect(out).toContain("--safe");
		expect(out).toContain(".aislopignore");
		expect(out).toContain("aislop commands");
		expect(out).toContain("aislop <cmd> --help");
		expect(out).toContain("npx aislop@latest scan");
		expect(out).toContain("Run aislop scan to scan your project");
		expect(out).not.toContain("Run npx aislop scan");
	});

	it("renders a full command reference", () => {
		const out = strip(renderCommandReference({ version: "1.2.3" }));

		expect(out).toContain("Commands");
		expect(out).toContain("aislop fix [directory]");
		expect(out).toContain("--safe");
		expect(out).toContain("-d, --verbose");
		expect(out).toContain("-f, --force");
		expect(out).toContain("-p, --prompt");
		expect(out).toContain("--deep-agents");
		expect(out).toContain("--crush");
		expect(out).toContain("aislop hooks");
		expect(out).toContain("aislop hook uninstall [agents...]");
		expect(out).toContain("aislop hook baseline");
		expect(out).toContain("aislop install [agents...]");
		expect(out).toContain("aislop uninstall [agents...]");
		expect(out).toContain("--agent <names>");
		expect(out).toContain("--quality-gate");
		expect(out).toContain("--copilot");
		expect(out).toContain("aislop badge [directory]");
		expect(out).toContain("--owner <owner>");
		expect(out).toContain("--limit <n>");
		expect(out).toContain("aislop version");
		expect(out).toContain(".aislopignore");
		expect(out).toContain("Run aislop <command> --help");
		expect(out).not.toContain("--all");
	});
});
