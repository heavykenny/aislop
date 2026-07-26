import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { formatEngine } from "../../src/engines/format/index.js";
import { lintEngine } from "../../src/engines/lint/index.js";
import type { EngineContext } from "../../src/engines/types.js";
import type { Framework, Language } from "../../src/utils/discover.js";

const tempRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "aislop-skip-"));

const ctx = (
	languages: Language[],
	installedTools: Record<string, boolean> = {},
	frameworks: Framework[] = [],
): EngineContext => ({
	rootDirectory: tempRoot(),
	languages,
	frameworks,
	installedTools,
	config: {
		quality: DEFAULT_CONFIG.quality,
		security: DEFAULT_CONFIG.security,
		lint: DEFAULT_CONFIG.lint,
	},
});

describe("format/lint engines skip honestly when no runner applies", () => {
	it("format reports skipped (not a false green) for a C# repo", async () => {
		const result = await formatEngine.run(ctx(["csharp"]));
		expect(result.skipped).toBe(true);
		expect(result.skipReason).toMatch(/formatter/);
	});

	it("lint reports skipped for a C# repo without roslynator installed", async () => {
		const result = await lintEngine.run(ctx(["csharp"], { roslynator: false }));
		expect(result.skipped).toBe(true);
		expect(result.skipReason).toMatch(/linter/);
	});

	it("format does NOT skip for a TypeScript repo (biome always runs)", async () => {
		const result = await formatEngine.run(ctx(["typescript"]));
		expect(result.skipped).toBe(false);
	});

	it("format does NOT skip for a C# repo when dotnet is installed", async () => {
		// Empty temp dir has no targets, so dotnet format finds nothing - but the
		// engine still RAN it, so this is a real "done", not a laundered false green.
		const result = await formatEngine.run(ctx(["csharp"], { dotnet: true }));
		expect(result.skipped).toBe(false);
	});
});
