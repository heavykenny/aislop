import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureInstallId, resolveInstallIdPath } from "../../src/telemetry/identity.js";

const makeTempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "aislop-telemetry-"));

describe("resolveInstallIdPath", () => {
	it("uses ~/.aislop/install_id by default", () => {
		const p = resolveInstallIdPath("/tmp/fake-home", {});
		expect(p).toBe(path.join("/tmp/fake-home", ".aislop", "install_id"));
	});

	it("honors XDG_STATE_HOME on linux", () => {
		if (process.platform !== "linux") return;
		const p = resolveInstallIdPath("/tmp/fake-home", { XDG_STATE_HOME: "/tmp/xdg" });
		expect(p).toBe("/tmp/xdg/aislop/install_id");
	});
});

describe("ensureInstallId", () => {
	let tmpHome: string;

	beforeEach(() => {
		tmpHome = makeTempHome();
	});

	afterEach(() => {
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	it("creates the file and returns created=true on first run", () => {
		const idPath = path.join(tmpHome, "install_id");
		const result = ensureInstallId(idPath);
		expect(result.created).toBe(true);
		expect(result.installId).toMatch(/^[0-9a-f-]{36}$/);
		expect(fs.readFileSync(idPath, "utf-8").trim()).toBe(result.installId);
	});

	it("returns created=false on subsequent runs", () => {
		const idPath = path.join(tmpHome, "install_id");
		const first = ensureInstallId(idPath);
		const second = ensureInstallId(idPath);
		expect(second.created).toBe(false);
		expect(second.installId).toBe(first.installId);
	});

	it("writes the file with owner-only permissions where the OS enforces them", () => {
		const idPath = path.join(tmpHome, "install_id");
		ensureInstallId(idPath);
		if (process.platform === "win32") {
			// Windows does not honor POSIX permission bits; assert the file exists instead.
			expect(fs.existsSync(idPath)).toBe(true);
		} else {
			const mode = fs.statSync(idPath).mode & 0o777;
			expect(mode).toBe(0o600);
		}
	});

	it("creates the parent directory if missing", () => {
		const idPath = path.join(tmpHome, "nested", "subdir", "install_id");
		const result = ensureInstallId(idPath);
		expect(result.created).toBe(true);
		expect(fs.existsSync(idPath)).toBe(true);
	});
});
