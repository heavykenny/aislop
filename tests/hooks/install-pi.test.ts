import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

	it("clears its timeout when the child cannot spawn", async () => {
		type HookCallback = (
			event: { toolName: string; isError: boolean; input: { path: string }; content: [] },
			context: { cwd: string; signal: AbortSignal },
		) => Promise<unknown>;
		let callback: HookCallback | undefined;
		const moduleUrl = `data:text/javascript;base64,${Buffer.from(PI_EXTENSION_SOURCE).toString("base64")}`;
		const extensionModule = (await import(moduleUrl)) as {
			default: (pi: { on: (event: string, handler: HookCallback) => void }) => void;
		};
		extensionModule.default({
			on: (_event, handler) => {
				callback = handler;
			},
		});
		if (!callback) throw new Error("Pi extension did not register its hook");

		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		vi.stubEnv("AISLOP_BIN", path.join(cwd, "missing-aislop"));
		try {
			await callback(
				{ toolName: "edit", isError: false, input: { path: "src/app.ts" }, content: [] },
				{ cwd, signal: new AbortController().signal },
			);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
			vi.unstubAllEnvs();
		}
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
