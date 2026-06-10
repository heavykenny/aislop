import { describe, expect, it } from "vitest";
import { renderCommandReference, renderHome, renderRootHelp } from "../../src/ui/home.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

describe("home", () => {
	it("renders a compact command home screen", () => {
		const out = strip(renderHome({ version: "1.2.3" }));

		expect(out).toContain("aislop 1.2.3");
		expect(out).toContain("> aislop scan");
		expect(out).not.toContain("$ aislop scan");
		expect(out).toContain("aislop scan");
		expect(out).toContain("Score this project and show findings");
		expect(out).toContain("aislop agent");
		expect(out).toContain("aislop ci");
		expect(out).toContain("aislop hook install");
		expect(out).not.toContain("Usage:");
	});

	it("renders root help with usage, options, and one-off npx wording", () => {
		const out = strip(renderRootHelp({ version: "1.2.3" }));

		expect(out).toContain("Usage");
		expect(out).toContain("aislop scan [options] [directory]");
		expect(out).toContain("aislop agent [options] [directory]");
		expect(out).toContain("aislop ci [options] [directory]");
		expect(out).toContain("--changes");
		expect(out).toContain("--base");
		expect(out).toContain("--safe");
		expect(out).toContain("aislop agent providers");
		expect(out).toContain("aislop agent monitor show");
		expect(out).toContain("aislop hook status");
		expect(out).toContain(".aislopignore");
		expect(out).toContain("aislop commands");
		expect(out).toContain("aislop <cmd> --help");
		expect(out).toContain("npx aislop@latest scan");
		expect(out).toContain("Interactive");
		expect(out).toContain("> aislop");
		expect(out).toContain("aislop trends [options] [directory]");
		expect(out).toContain("aislop trends --limit 10");
		expect(out).toContain("Run aislop scan to scan your project");
		expect(out).not.toContain("Run npx aislop scan");
	});

	it("renders a full command reference", () => {
		const out = strip(renderCommandReference({ version: "1.2.3" }));

		expect(out).toContain("Commands");
		expect(out).toContain("Guide");
		expect(out).toContain("[directory] means a repo or path to scan");
		expect(out).toContain("Examples");
		expect(out).toContain("aislop trends --limit 10");
		expect(out).toContain("Flag guide");
		expect(out).toContain("Core workflow");
		expect(out).toContain("Local agent");
		expect(out).toContain("Project setup");
		expect(out).toContain("Hooks");
		expect(out).toContain("Reporting");
		expect(out).toContain("aislop [directory]");
		expect(out).toContain("aislop fix [directory]");
		expect(out).toContain("aislop agent [directory]");
		expect(out).toContain("aislop agent plan [directory]");
		expect(out).toContain("aislop agent providers");
		expect(out).toContain("aislop agent connect [provider]");
		expect(out).toContain("aislop agent use [provider]");
		expect(out).toContain("aislop agent switch [provider]");
		expect(out).toContain("aislop agent monitor [directory]");
		expect(out).toContain("aislop agent monitor list [directory]");
		expect(out).toContain("aislop agent monitor stop [monitor]");
		expect(out).toContain("aislop agent sessions [directory]");
		expect(out).toContain("aislop agent show [session]");
		expect(out).toContain("aislop agent apply [session]");
		expect(out).toContain("aislop agent watch [session]");
		expect(out).toContain("aislop agent stop [session]");
		expect(out).toContain("--provider <provider>");
		expect(out).toContain("--target-score <score>");
		expect(out).toContain("--max-turns <n>");
		expect(out).toContain("--commit-message <message>");
		expect(out).toContain("--base <ref>");
		expect(out).toContain("--dry-run");
		expect(out).toContain("--no-fix");
		expect(out).toContain("--background");
		expect(out).toContain("--safe");
		expect(out).toContain("-d, --verbose");
		expect(out).toContain("-f, --force");
		expect(out).toContain("-p, --prompt");
		expect(out).toContain("--deep-agents");
		expect(out).toContain("--crush");
		expect(out).toContain("aislop hook");
		expect(out).toContain("aislop hooks");
		expect(out).toContain("aislop hook uninstall [agents...]");
		expect(out).toContain("aislop hook baseline");
		expect(out).toContain("aislop install [agents...]");
		expect(out).toContain("aislop uninstall [agents...]");
		expect(out).toContain("--agent <names>");
		expect(out).toContain("--quality-gate");
		expect(out).toContain("--copilot");
		expect(out).toContain("aislop badge [directory]");
		expect(out).toContain("aislop trends [directory]");
		expect(out).toContain("--owner <owner>");
		expect(out).toContain("--limit <n>");
		expect(out).toContain("aislop version");
		expect(out).toContain(".aislopignore");
		expect(out).toContain("Run aislop <command> --help");
		expect(out).not.toContain("--all");

		const flagLines = out.split("\n").filter((line) => line.trimStart().startsWith("flags:"));
		expect(flagLines.length).toBeGreaterThan(0);
		expect(out.split("\n").every((line) => line.length <= 120)).toBe(true);

		const descriptionColumns = [
			["aislop", "Open the interactive menu"],
			["aislop scan [directory]", "Score code quality"],
			["aislop agent [directory]", "Create a local worktree"],
			["aislop hook install [agents...]", "Install coding-agent hooks"],
			["aislop badge [directory]", "Print score badge"],
		].map(([command, summary]) => {
			const line = out
				.split("\n")
				.find((candidate) => candidate.includes(command) && candidate.includes(summary));
			expect(line).toBeDefined();
			return line?.indexOf(summary) ?? -1;
		});
		expect(new Set(descriptionColumns).size).toBe(1);
		const summaryColumn = descriptionColumns[0];
		const firstFlagLine = flagLines.find((line) => line.includes("--changes"));
		expect(firstFlagLine).toBeDefined();
		const flagLabelColumn = firstFlagLine?.indexOf("flags:") ?? -1;
		const flagValueColumn = firstFlagLine?.indexOf("--changes") ?? -1;
		expect(flagLabelColumn).toBe(summaryColumn);
		expect(flagValueColumn).toBeGreaterThan(flagLabelColumn);
		const continuationLine = out
			.split("\n")
			.find((line) => line.includes("--format <format>") && !line.includes("flags:"));
		expect(continuationLine).toBeDefined();
		expect(continuationLine?.indexOf("--format <format>")).toBe(flagValueColumn);
	});
});
