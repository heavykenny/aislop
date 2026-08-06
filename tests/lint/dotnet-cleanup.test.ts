import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { EngineContext } from "../../src/engines/types.js";

const { runSubprocess } = vi.hoisted(() => ({ runSubprocess: vi.fn() }));

vi.mock("../../src/utils/subprocess.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/utils/subprocess.js")>();
	return { ...actual, runSubprocess };
});

const { runDotnetLint } = await import("../../src/engines/lint/dotnet.js");

describe("runDotnetLint report cleanup", () => {
	let rootDirectory: string;

	beforeEach(() => {
		runSubprocess.mockReset();
		rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-dotnet-cleanup-"));
		fs.writeFileSync(path.join(rootDirectory, "App.csproj"), "");
		fs.mkdirSync(path.join(rootDirectory, "obj"));
		fs.writeFileSync(path.join(rootDirectory, "obj", "project.assets.json"), "{}");
	});

	afterEach(() => {
		fs.rmSync(rootDirectory, { recursive: true, force: true });
	});

	it("removes the temporary report directory when Roslynator fails", async () => {
		let reportPath = "";
		runSubprocess.mockImplementation(async (_command, args: string[]) => {
			reportPath = args[args.indexOf("--output") + 1];
			throw new Error("roslynator failed");
		});
		const context: EngineContext = {
			rootDirectory,
			languages: ["csharp"],
			frameworks: [],
			installedTools: { roslynator: true },
			config: {
				quality: DEFAULT_CONFIG.quality,
				security: DEFAULT_CONFIG.security,
				lint: DEFAULT_CONFIG.lint,
			},
		};

		expect(await runDotnetLint(context)).toEqual([]);
		expect(reportPath).not.toBe("");
		expect(fs.existsSync(path.dirname(reportPath))).toBe(false);
	});
});
