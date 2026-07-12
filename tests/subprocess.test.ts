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

describe("runSubprocess timeout under event-loop starvation", () => {
	it("does not reject a child that completed while the event loop was blocked", async () => {
		// The child exits almost immediately, well inside the 500ms timeout.
		// The test then blocks the event loop past the timeout expiry, so on
		// wake the expired timer callback runs before the child's exit/close
		// events (timers phase precedes poll phase). The completion must win.
		const promise = runSubprocess(process.execPath, ["-e", "process.stdout.write('ok')"], {
			timeout: 500,
		});

		// Hop into a check-phase (setImmediate) callback first: its loop
		// iteration is already past the poll phase, so after the spin the
		// NEXT iteration begins with the timers phase and runs the (now
		// expired) timeout timer BEFORE the poll phase that would deliver the
		// child's exit/close events. Spinning from a poll- or timers-phase
		// continuation instead would let the completion win by accident and
		// mask the bug.
		await new Promise((resolve) => setImmediate(resolve));

		// Starve the loop: the child (an independent OS process) runs and
		// exits during the spin, but its exit/close events cannot be
		// processed until the spin ends - after the timer has already expired.
		const spinUntil = Date.now() + 1200;
		while (Date.now() < spinUntil) {
			// Busy-wait: simulates a synchronous engine pass starving the loop.
		}

		await expect(promise).resolves.toMatchObject({ stdout: "ok", exitCode: 0 });
	});
});
