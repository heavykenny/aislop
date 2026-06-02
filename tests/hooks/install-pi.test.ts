import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	installPi,
	PI_EXTENSION_SOURCE,
	resolvePiPaths,
	uninstallPi,
} from "../../src/hooks/install/pi.js";

let home: string;
let cwd: string;

beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-home-"));
	cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-cwd-"));
});

afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
	fs.rmSync(cwd, { recursive: true, force: true });
});

describe("PI_EXTENSION_SOURCE", () => {
	it("subscribes to tool_result and shells out to aislop hook pi", () => {
		expect(PI_EXTENSION_SOURCE).toContain('pi.on("tool_result"');
		expect(PI_EXTENSION_SOURCE).toContain('["hook", "pi"]');
		expect(PI_EXTENSION_SOURCE).toContain("AISLOP_BIN");
	});
});

describe("installPi", () => {
	it("writes the extension to the global pi extensions dir", () => {
		const opts = { home, cwd, scope: "global" as const };
		installPi(opts);
		const paths = resolvePiPaths(opts);
		expect(paths.extension).toBe(path.join(home, ".pi", "agent", "extensions", "aislop.js"));
		expect(fs.readFileSync(paths.extension, "utf-8")).toBe(PI_EXTENSION_SOURCE);
	});

	it("writes the extension to the project .pi dir in project scope", () => {
		const opts = { home, cwd, scope: "project" as const };
		installPi(opts);
		const paths = resolvePiPaths(opts);
		expect(paths.extension).toBe(path.join(cwd, ".pi", "extensions", "aislop.js"));
		expect(fs.existsSync(paths.extension)).toBe(true);
	});

	it("uninstalls cleanly", () => {
		const opts = { home, cwd, scope: "global" as const };
		installPi(opts);
		const paths = resolvePiPaths(opts);
		expect(fs.existsSync(paths.extension)).toBe(true);
		uninstallPi(opts);
		expect(fs.existsSync(paths.extension)).toBe(false);
	});
});
