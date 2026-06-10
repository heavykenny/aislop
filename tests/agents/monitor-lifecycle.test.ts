import { afterEach, describe, expect, it, vi } from "vitest";
import { signalMonitorProcess } from "../../src/commands/agent-monitor-lifecycle.js";

describe("agent monitor lifecycle", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("signals the monitor process group on non-Windows platforms", () => {
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

		signalMonitorProcess(1234, "SIGTERM");

		expect(kill).toHaveBeenCalledWith(process.platform === "win32" ? 1234 : -1234, "SIGTERM");
	});

	it("falls back to the monitor pid when the process group is gone", () => {
		if (process.platform === "win32") return;
		const missingGroup = Object.assign(new Error("missing process group"), { code: "ESRCH" });
		const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
			if (pid === -1234) throw missingGroup;
			return true;
		});

		signalMonitorProcess(1234, "SIGTERM");

		expect(kill).toHaveBeenNthCalledWith(1, -1234, "SIGTERM");
		expect(kill).toHaveBeenNthCalledWith(2, 1234, "SIGTERM");
	});
});
