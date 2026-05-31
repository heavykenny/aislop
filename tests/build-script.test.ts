import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(__dirname, "..");

// Resolve tsdown's JS entry and run it via process.execPath instead of the
// node_modules/.bin/tsdown shell shim, which spawn() cannot execute on Windows
// without a shell -- the same cross-platform constraint the build script encodes.
const resolveTsdownBin = (): string => {
	const require = createRequire(import.meta.url);
	const packageJsonPath = require.resolve("tsdown/package.json");
	const { bin } = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
		bin: string | Record<string, string>;
	};
	const binEntry = typeof bin === "string" ? bin : bin.tsdown;
	return path.join(path.dirname(packageJsonPath), binEntry);
};

let outputDir: string;

beforeEach(() => {
	outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-build-"));
});

afterEach(() => {
	fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("build script", () => {
	// The "build" script is just `tsdown` (no `rm -rf dist`) because tsdown cleans
	// its output directory by default. This pins that behavior: if a tsdown upgrade
	// or a `clean: false` in tsdown.config.ts ever stopped the clean, stale build
	// artifacts would ship and this test would fail.
	it("tsdown clears stale files from its output directory", () => {
		const stalePath = path.join(outputDir, "stale-artifact.js");
		fs.writeFileSync(stalePath, "module.exports = 'stale';\n");

		// Build the real project config into a throwaway directory. --no-dts keeps it
		// fast; the clean behavior under test still comes from tsdown.config.ts.
		execFileSync(
			process.execPath,
			[resolveTsdownBin(), "--out-dir", outputDir, "--no-dts", "--silent"],
			{ cwd: PROJECT_ROOT, stdio: "ignore", timeout: 120_000 },
		);

		expect(fs.existsSync(stalePath)).toBe(false);
		// Guard against a false pass: confirm the build actually produced output.
		expect(fs.existsSync(path.join(outputDir, "cli.js"))).toBe(true);
	});
});
