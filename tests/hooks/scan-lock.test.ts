import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireHookLock } from "../../src/hooks/io/scan-lock.js";

let cwd: string;

beforeEach(() => {
	cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-lock-"));
});

afterEach(() => {
	fs.rmSync(cwd, { recursive: true, force: true });
});

const lockPath = (dir: string) => path.join(dir, ".aislop", "hook.lock");

describe("acquireHookLock", () => {
	it("creates the lock file and returns a release function", () => {
		const release = acquireHookLock(cwd);
		expect(release).not.toBeNull();
		expect(fs.existsSync(lockPath(cwd))).toBe(true);
		release?.();
		expect(fs.existsSync(lockPath(cwd))).toBe(false);
	});

	it("refuses to acquire when a fresh lock exists", () => {
		const first = acquireHookLock(cwd);
		expect(first).not.toBeNull();
		const second = acquireHookLock(cwd);
		expect(second).toBeNull();
		first?.();
	});

	it("reclaims a stale lock (> 30s old)", () => {
		fs.mkdirSync(path.dirname(lockPath(cwd)), { recursive: true });
		fs.writeFileSync(lockPath(cwd), JSON.stringify({ pid: 99999, ts: Date.now() - 60_000 }));
		const release = acquireHookLock(cwd);
		expect(release).not.toBeNull();
		release?.();
	});

	it("treats a malformed lock file as reclaimable", () => {
		fs.mkdirSync(path.dirname(lockPath(cwd)), { recursive: true });
		fs.writeFileSync(lockPath(cwd), "{not valid json");
		const release = acquireHookLock(cwd);
		expect(release).not.toBeNull();
		release?.();
	});

	it("release only removes the lock if this process still owns it", () => {
		const release = acquireHookLock(cwd);
		expect(release).not.toBeNull();
		// Simulate another process stealing the lock after ours expired
		fs.writeFileSync(lockPath(cwd), JSON.stringify({ pid: 54321, ts: Date.now() }));
		release?.();
		// Stolen lock should still be present
		expect(fs.existsSync(lockPath(cwd))).toBe(true);
	});
});
