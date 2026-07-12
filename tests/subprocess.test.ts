import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runSubprocess } from "../src/utils/subprocess.js";

const isProcessAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe("runSubprocess timeout", () => {
	it("kills the whole process tree on timeout, not just the direct child", async () => {
		const pidFile = path.join(tmpdir(), `aislop-treekill-${process.pid}-${Date.now()}.pid`);
		// The direct child spawns a grandchild (like cppcheck -j spawning
		// workers), records its PID, then idles until the timeout reaps it.
		// On Windows the grandchild is detached: a node middleman puts its
		// children in a kill-on-close Job Object, which real scanner binaries
		// do not do - detaching opts out so the test models a real tool tree.
		const parentScript = [
			`const child = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: process.platform === "win32" });`,
			`require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
			"setInterval(() => {}, 1000);",
		].join("\n");

		let grandchildPid: number | undefined;
		try {
			await expect(
				runSubprocess(process.execPath, ["-e", parentScript], { timeout: 2000 }),
			).rejects.toThrow(/timed out/);

			grandchildPid = Number(readFileSync(pidFile, "utf-8"));
			expect(Number.isInteger(grandchildPid)).toBe(true);

			// The tree kill is asynchronous (taskkill on Windows, signal
			// escalation elsewhere) - poll rather than asserting instantly.
			const deadline = Date.now() + 5000;
			while (isProcessAlive(grandchildPid) && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			expect(isProcessAlive(grandchildPid)).toBe(false);
		} finally {
			if (grandchildPid !== undefined && isProcessAlive(grandchildPid)) {
				try {
					process.kill(grandchildPid, "SIGKILL");
				} catch {}
			}
			rmSync(pidFile, { force: true });
		}
	});
});
