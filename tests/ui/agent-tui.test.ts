import { describe, expect, it } from "vitest";
import { AgentTui } from "../../src/ui/agent-tui.js";
import { createSymbols } from "../../src/ui/symbols.js";
import { createTheme } from "../../src/ui/theme.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

const ALT_SCREEN_ON = "\x1B[?1049h";
const ALT_SCREEN_OFF = "\x1B[?1049l";
const HIDE_CURSOR = "\x1B[?25l";
const SHOW_CURSOR = "\x1B[?25h";
const CLEAR_SCREEN = "\x1B[H\x1B[2J";

const mkTui = (tty: boolean) => {
	const chunks: string[] = [];
	const tui = new AgentTui({
		provider: "Codex",
		source: "--provider flag",
		directory: "/repo",
		mode: "isolated worktree",
		targetScore: 90,
		tty,
		columns: 90,
		rows: 24,
		write: (chunk) => chunks.push(chunk),
		theme: createTheme({ color: "truecolor", tty: true }),
		symbols: createSymbols({ plain: false }),
	});
	return { tui, chunks };
};

describe("AgentTui", () => {
	it("renders an alternate-screen dashboard and exits back to the terminal on finish", () => {
		const { tui, chunks } = mkTui(true);

		tui.start("Preparing local session");
		tui.setMetric("Score", "72 -> ...");
		tui.appendLog("codex", "assistant: edited src/a.ts");
		tui.complete({ status: "done", label: "Created worktree .aislop/agent/worktrees/run" });
		tui.finish({ footer: "Done · codex · 1200ms" });

		const raw = chunks.join("");
		const stripped = strip(raw);
		expect(raw.startsWith(`${ALT_SCREEN_ON}${HIDE_CURSOR}`)).toBe(true);
		expect(raw).toContain(CLEAR_SCREEN);
		expect(raw.endsWith(`${SHOW_CURSOR}${ALT_SCREEN_OFF}`)).toBe(true);
		expect(stripped).toContain("aislop agent");
		expect(stripped).toContain("Codex");
		expect(stripped).toContain("Metrics");
		expect(stripped).toContain("Score");
		expect(stripped).toContain("Live output");
		expect(stripped).toContain("codex");
		expect(stripped).toContain("assistant: edited src/a.ts");
	});

	it("leaves the alternate screen while prompting and resumes the dashboard after", () => {
		const { tui, chunks } = mkTui(true);

		tui.start("Verifying agent diff");
		tui.pause();
		tui.resume();
		tui.finish({ footer: "Done · codex · 900ms" });

		const raw = chunks.join("");
		expect(raw).toContain(`${SHOW_CURSOR}${ALT_SCREEN_OFF}${ALT_SCREEN_ON}${HIDE_CURSOR}`);
		expect(raw.endsWith(`${SHOW_CURSOR}${ALT_SCREEN_OFF}`)).toBe(true);
	});

	it("uses append-only output in non-TTY environments", () => {
		const { tui, chunks } = mkTui(false);

		tui.start("Preparing local session");
		tui.appendLog("codex", "assistant: fixed issue");
		tui.complete({ status: "done", label: "Using current worktree" });
		tui.finish({ footer: "Done · codex · 800ms" });

		const out = strip(chunks.join(""));
		expect(out).not.toContain(ALT_SCREEN_ON);
		expect(out).toContain("codex    assistant: fixed issue");
		expect(out).toContain("Using current worktree");
		expect(out).toContain("Done · codex · 800ms");
	});
});
