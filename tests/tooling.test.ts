import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveToolBinary } from "../src/utils/tooling.js";

const exeName = (tool: string): string => (process.platform === "win32" ? `${tool}.exe` : tool);

describe("resolveToolBinary", () => {
	const originalPath = process.env.PATH;
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-tooling-"));
	});

	afterEach(() => {
		process.env.PATH = originalPath;
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("prefers a system-installed bundled tool (ruff) on PATH over the vendored copy", () => {
		// The vendored ruff drifts from the project's pinned ruff across style
		// editions; the project's installed ruff (what CI gates on) must win.
		const systemRuff = path.join(tempDir, exeName("ruff"));
		fs.writeFileSync(systemRuff, "");
		if (process.platform !== "win32") fs.chmodSync(systemRuff, 0o755);
		process.env.PATH = tempDir;

		expect(resolveToolBinary("ruff")).toBe(systemRuff);
	});

	it("ignores a non-executable PATH entry and falls back to the vendored/bare name", () => {
		// existsSync would match a directory (or, on POSIX, a non-executable file) named
		// like the tool, but spawning it fails - so it must not shadow the bundled copy.
		const shadow = path.join(tempDir, exeName("ruff"));
		fs.mkdirSync(shadow); // a directory wearing the executable's name
		process.env.PATH = tempDir;

		const resolved = resolveToolBinary("ruff");
		expect(resolved).not.toBe(shadow);
		expect(resolved === "ruff" || resolved.includes(path.join("tools", "bin"))).toBe(true);
	});

	it("falls back to the vendored binary or bare name when a bundled tool is absent from PATH", () => {
		process.env.PATH = tempDir; // empty dir: ruff is not here
		const resolved = resolveToolBinary("ruff");

		// Never a hit inside the empty PATH dir; either the vendored tools/bin copy
		// (when present) or the bare name for OS resolution at spawn.
		expect(resolved).not.toBe(path.join(tempDir, exeName("ruff")));
		expect(resolved === "ruff" || resolved.includes(path.join("tools", "bin"))).toBe(true);
	});

	it("returns the bare name for a non-bundled tool regardless of PATH", () => {
		// roslynator/jb are not vendored: leave OS PATH+PATHEXT resolution to spawn.
		const fakeRoslynator = path.join(tempDir, exeName("roslynator"));
		fs.writeFileSync(fakeRoslynator, "");
		process.env.PATH = tempDir;

		expect(resolveToolBinary("roslynator")).toBe("roslynator");
	});
});
