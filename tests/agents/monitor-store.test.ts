import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type AgentMonitorRecord,
	appendAgentMonitorCycle,
	listAgentMonitors,
	resolveAgentMonitorPath,
	writeAgentMonitorRecord,
} from "../../src/agents/monitor-store.js";
import {
	renderAgentMonitorList,
	renderAgentMonitorShow,
	stopAgentMonitor,
} from "../../src/commands/agent-monitor-lifecycle.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

let tempDirs: string[] = [];

const tempRoot = (): string => {
	const root = mkdtempSync(path.join(tmpdir(), "aislop-agent-monitor-"));
	tempDirs.push(root);
	return root;
};

const record = (root: string, overrides: Partial<AgentMonitorRecord> = {}): AgentMonitorRecord => ({
	id: "monitor-20260607-101010-42",
	root,
	requestedDirectory: root,
	startedAt: "2026-06-07T10:10:10.000Z",
	pid: 999999,
	provider: "codex",
	providerSource: "auto",
	repair: false,
	inPlace: false,
	interval: 5000,
	debounce: 1500,
	targetScore: 90,
	maxTurns: 4,
	limit: 8,
	noFix: false,
	logPath: path.join(root, ".aislop", "agent", "logs", "monitor.log"),
	...overrides,
});

describe("agent monitor store", () => {
	afterEach(() => {
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempDirs = [];
	});

	it("stores, lists, resolves, and renders monitor records", () => {
		const root = tempRoot();
		writeAgentMonitorRecord(root, record(root));
		writeAgentMonitorRecord(
			root,
			record(root, {
				id: "monitor-20260607-111111-42",
				startedAt: "2026-06-07T11:11:11.000Z",
				repair: true,
				inPlace: true,
				recentCycles: [
					{
						timestamp: "2026-06-07T11:12:00.000Z",
						reason: "settled changes",
						score: 96,
						diagnostics: 1,
						findings: 1,
						changedFiles: ["src/a.ts"],
						repaired: false,
						targetMet: true,
					},
				],
			}),
		);

		const monitors = listAgentMonitors(root);
		expect(monitors.map((monitor) => monitor.id)).toEqual([
			"monitor-20260607-111111-42",
			"monitor-20260607-101010-42",
		]);
		expect(resolveAgentMonitorPath(root, "monitor-20260607-111111")).toBe(monitors[0]?.path);

		const list = strip(renderAgentMonitorList({ root, monitors }));
		expect(list).toContain("Agent monitors");
		expect(list).toContain("monitor-20260607-111111-42");
		expect(list).toContain("repair");
		expect(list).toMatch(/Status\s+exited/);
		expect(list).toMatch(/Latest\s+96\/100, 1 finding/);
		expect(list).not.toMatch(/monitor-20260607-111111-42\s+exited/);

		const listLines = list.split("\n");
		const statusLine = listLines.find((line) => line.includes("Status") && line.includes("exited"));
		const latestLine = listLines.find((line) => line.includes("Latest") && line.includes("96/100"));
		expect(statusLine?.indexOf("exited")).toBe(latestLine?.indexOf("96/100"));

		const show = strip(renderAgentMonitorShow(monitors[0]));
		expect(show).toMatch(/Status\s+exited/);
		expect(show).toMatch(/Mode\s+repair/);
		expect(show).toContain("Log");
		expect(show).toContain("Recent cycles");
		expect(show).toContain("src/a.ts");
	});

	it("keeps a bounded recent cycle history", () => {
		const root = tempRoot();
		writeAgentMonitorRecord(root, record(root));

		for (let index = 0; index < 4; index += 1) {
			appendAgentMonitorCycle(
				root,
				"monitor-20260607-101010-42",
				{
					timestamp: `2026-06-07T10:1${index}:00.000Z`,
					reason: "settled changes",
					score: 90 + index,
					diagnostics: index,
					findings: index,
					changedFiles: [`src/${index}.ts`],
					repaired: false,
					targetMet: true,
				},
				2,
			);
		}

		const [monitor] = listAgentMonitors(root);
		expect(monitor.recentCycles?.map((cycle) => cycle.score)).toEqual([92, 93]);
	});

	it("marks an exited monitor stopped without requiring a live process", async () => {
		const root = tempRoot();
		writeAgentMonitorRecord(root, record(root));

		const stopped = await stopAgentMonitor(root, undefined, { force: false });

		expect(stopped.status).toBe("stopped");
		expect(stopped.signal).toBe("SIGTERM");
		expect(stopped.stoppedAt).toBeTruthy();
	});
});
