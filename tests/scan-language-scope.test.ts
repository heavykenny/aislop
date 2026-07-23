import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { AislopConfig } from "../src/config/index.js";

const { runEnginesWithProgress } = vi.hoisted(() => ({
	runEnginesWithProgress: vi.fn(),
}));

vi.mock("../src/commands/scan-engine-runner.js", () => ({ runEnginesWithProgress }));

const { scanCommand } = await import("../src/commands/scan.js");

const writeFile = (rootDirectory: string, relativePath: string, content: string): string => {
	const filePath = path.join(rootDirectory, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
};

describe("scan language scope", () => {
	let rootDirectory: string;

	beforeEach(() => {
		rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-scan-language-"));
		runEnginesWithProgress.mockReset();
		runEnginesWithProgress.mockResolvedValue([]);
		vi.spyOn(console, "log").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(rootDirectory, { recursive: true, force: true });
	});

	it("does not enable languages found only outside the selected files", async () => {
		const selectedFile = writeFile(rootDirectory, "src/web/app.ts", "export const app = true;\n");
		writeFile(rootDirectory, "native/main.go", "package main\n");
		writeFile(rootDirectory, "go.mod", "module example.com/app\n\ngo 1.24\n");
		writeFile(rootDirectory, "tsconfig.json", "{}\n");

		const config: AislopConfig = {
			...DEFAULT_CONFIG,
			include: ["src/web"],
			security: { ...DEFAULT_CONFIG.security, audit: false },
			telemetry: { enabled: false },
		};

		await scanCommand(rootDirectory, config, {
			changes: false,
			staged: false,
			verbose: false,
			json: true,
			showHeader: false,
			printBrand: false,
		});

		expect(runEnginesWithProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [selectedFile],
				languages: ["typescript"],
			}),
			config.engines,
			true,
		);
	});
});
