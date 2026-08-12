import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanCommand } from "../src/commands/scan.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { AislopConfig } from "../src/config/index.js";
import { recordCompletedFullScan } from "../src/engagement/pilot-invitation.js";

let projectDir: string;
let stateHome: string;
const noFollowFlag: unknown = Reflect.get(fs.constants, "O_NOFOLLOW");
const secureNoFollowAvailable = typeof noFollowFlag === "number" && noFollowFlag !== 0;

const config: AislopConfig = {
	...DEFAULT_CONFIG,
	engines: {
		format: false,
		lint: false,
		"code-quality": false,
		"ai-slop": false,
		architecture: false,
		security: false,
	},
	telemetry: { enabled: true },
};

const pilotStatePath = (): string =>
	process.platform === "linux"
		? path.join(stateHome, "aislop", "pilot_invitation.scans")
		: path.join(stateHome, ".aislop", "pilot_invitation.scans");

const runStateWorker = (moduleUrl: string, statePath: string): Promise<number | null> =>
	new Promise((resolve, reject) => {
		const source = `import { recordCompletedFullScan } from ${JSON.stringify(moduleUrl)}; process.exit(recordCompletedFullScan(${JSON.stringify(statePath)}) ? 0 : 2);`;
		const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
			stdio: "ignore",
		});
		child.once("error", reject);
		child.once("close", resolve);
	});

const runHumanScan = async (
	overrides: Partial<Parameters<typeof scanCommand>[2]> = {},
	scanConfig: AislopConfig = config,
): Promise<string> => {
	vi.mocked(process.stdout.write).mockClear();
	await scanCommand(projectDir, scanConfig, {
		changes: false,
		staged: false,
		verbose: false,
		json: false,
		showHeader: false,
		printBrand: true,
		...overrides,
	});
	return vi
		.mocked(process.stdout.write)
		.mock.calls.map(([chunk]) => String(chunk))
		.join("");
};

beforeEach(() => {
	projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-pilot-project-"));
	stateHome = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-pilot-state-"));
	fs.mkdirSync(path.join(projectDir, "src"));
	fs.writeFileSync(path.join(projectDir, "src", "app.ts"), "export const app = true;\n");
	vi.stubEnv("HOME", stateHome);
	vi.stubEnv("XDG_STATE_HOME", stateHome);
	vi.stubEnv("CI", "");
	vi.stubEnv("GITHUB_ACTIONS", "");
	vi.stubEnv("AISLOP_TELEMETRY_DRY_RUN", "1");
	vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	fs.rmSync(projectDir, { recursive: true, force: true });
	fs.rmSync(stateHome, { recursive: true, force: true });
});

describe("pilot invitation", () => {
	it.runIf(secureNoFollowAvailable)(
		"appears once after the third completed full local scan",
		async () => {
			const first = await runHumanScan();
			const second = await runHumanScan();
			const third = await runHumanScan();
			const fourth = await runHumanScan();

			expect(first).not.toContain("intent=team-baseline");
			expect(second).not.toContain("intent=team-baseline");
			expect(third).toContain("intent=team-baseline");
			expect(fourth).not.toContain("intent=team-baseline");
		},
	);

	it("does not persist engagement state when local history is disabled", async () => {
		vi.stubEnv("AISLOP_NO_HISTORY", "1");

		const outputs = [await runHumanScan(), await runHumanScan(), await runHumanScan()];

		expect(outputs.every((output) => !output.includes("intent=team-baseline"))).toBe(true);
		expect(fs.existsSync(pilotStatePath())).toBe(false);
	});

	it.each(["AISLOP_NO_TELEMETRY", "DO_NOT_TRACK"])(
		"does not persist engagement state when %s is set",
		async (variable) => {
			vi.stubEnv(variable, "1");

			const outputs = [await runHumanScan(), await runHumanScan(), await runHumanScan()];

			expect(outputs.every((output) => !output.includes("intent=team-baseline"))).toBe(true);
			expect(fs.existsSync(pilotStatePath())).toBe(false);
		},
	);

	it("does not persist engagement state when telemetry is disabled in config", async () => {
		const telemetryDisabledConfig = { ...config, telemetry: { enabled: false } };

		const outputs = [
			await runHumanScan({}, telemetryDisabledConfig),
			await runHumanScan({}, telemetryDisabledConfig),
			await runHumanScan({}, telemetryDisabledConfig),
		];

		expect(outputs.every((output) => !output.includes("intent=team-baseline"))).toBe(true);
		expect(fs.existsSync(pilotStatePath())).toBe(false);
	});

	it("does not count machine, CI, scoped, filtered, or unbranded scans", async () => {
		await runHumanScan({ json: true });
		await runHumanScan({ sarif: true });
		vi.stubEnv("CI", "1");
		await runHumanScan();
		vi.stubEnv("CI", "");
		await runHumanScan({ staged: true });
		await runHumanScan({ include: ["src/**"] });
		await runHumanScan({ exclude: ["src/**"] });
		await runHumanScan({ printBrand: false });

		expect(fs.existsSync(pilotStatePath())).toBe(false);
		expect(await runHumanScan()).not.toContain("intent=team-baseline");
		// 8 sequential real scan invocations; a loaded Windows CI runner has been
		// observed blowing past the 30s suite default on this test alone.
	}, 120_000);

	it("preserves history when an unbranded scan suppresses the invitation", async () => {
		fs.mkdirSync(path.join(projectDir, ".aislop"));

		await runHumanScan({ printBrand: false });

		const history = fs.readFileSync(path.join(projectDir, ".aislop", "history.jsonl"), "utf8");
		expect(history.trim().split("\n")).toHaveLength(1);
		expect(fs.existsSync(pilotStatePath())).toBe(false);
	});

	it("preserves history when one-off filters suppress the invitation", async () => {
		fs.mkdirSync(path.join(projectDir, ".aislop"));

		await runHumanScan({ include: ["src/**"] });
		await runHumanScan({ exclude: ["dist"] });

		const history = fs.readFileSync(path.join(projectDir, ".aislop", "history.jsonl"), "utf8");
		expect(history.trim().split("\n")).toHaveLength(2);
		expect(fs.existsSync(pilotStatePath())).toBe(false);
	});

	it.runIf(secureNoFollowAvailable)(
		"treats configured filters as the stable project baseline",
		async () => {
			const configuredScope = {
				...config,
				include: ["src/**"],
				exclude: [...config.exclude, "generated"],
			};

			const first = await runHumanScan({}, configuredScope);
			const second = await runHumanScan({}, configuredScope);
			const third = await runHumanScan({}, configuredScope);

			expect(first).not.toContain("intent=team-baseline");
			expect(second).not.toContain("intent=team-baseline");
			expect(third).toContain("intent=team-baseline");
		},
	);

	it.runIf(secureNoFollowAvailable)("does not follow a symlink at the final state path", () => {
		const statePath = path.join(stateHome, "direct", "pilot_invitation.json");
		const protectedPath = path.join(stateHome, "protected.txt");
		fs.mkdirSync(path.dirname(statePath), { recursive: true });
		fs.writeFileSync(protectedPath, "unchanged");
		fs.symlinkSync(protectedPath, statePath);

		recordCompletedFullScan(statePath);

		expect(fs.readFileSync(protectedPath, "utf8")).toBe("unchanged");
	});

	it("fails closed when the state directory is a symlink", () => {
		const realDirectory = path.join(stateHome, "real-state");
		const linkedDirectory = path.join(stateHome, "linked-state");
		const statePath = path.join(linkedDirectory, "pilot_invitation.scans");
		fs.mkdirSync(realDirectory);
		fs.symlinkSync(realDirectory, linkedDirectory);

		expect(recordCompletedFullScan(statePath)).toBe(false);
		expect(fs.readdirSync(realDirectory)).toEqual([]);
	});

	it("fails closed when a no-follow file open is unavailable", () => {
		const statePath = path.join(stateHome, "unsupported", "pilot_invitation.scans");

		expect(recordCompletedFullScan(statePath, null)).toBe(false);
		expect(fs.existsSync(statePath)).toBe(false);
	});

	it("fails closed before reading an oversized counter", () => {
		const statePath = path.join(stateHome, "oversized", "pilot_invitation.scans");
		fs.mkdirSync(path.dirname(statePath), { recursive: true });
		fs.writeFileSync(statePath, "1\n".repeat(4097), { mode: 0o600 });

		expect(recordCompletedFullScan(statePath)).toBe(false);
		expect(fs.statSync(statePath).size).toBe(8194);
	});

	it.runIf(secureNoFollowAvailable)(
		"stores state and the one-time claim with private permissions",
		() => {
			const statePath = path.join(stateHome, "private", "pilot_invitation.json");

			expect(recordCompletedFullScan(statePath)).toBe(false);
			expect(recordCompletedFullScan(statePath)).toBe(false);
			expect(recordCompletedFullScan(statePath)).toBe(true);
			expect(recordCompletedFullScan(statePath)).toBe(false);

			expect(fs.statSync(statePath).mode & 0o777).toBe(0o600);
			expect(fs.statSync(`${statePath}.shown`).mode & 0o777).toBe(0o600);
		},
	);

	it.runIf(secureNoFollowAvailable)(
		"counts three concurrent processes without duplicate invitations",
		async () => {
			const sourcePath = path.resolve("src/engagement/pilot-invitation.ts");
			const modulePath = path.join(stateHome, "pilot-invitation.mjs");
			const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
				compilerOptions: {
					module: ts.ModuleKind.ESNext,
					target: ts.ScriptTarget.ES2022,
				},
			}).outputText;
			fs.writeFileSync(modulePath, compiled);
			const moduleUrl = pathToFileURL(modulePath).href;
			const statePath = path.join(stateHome, "concurrent", "pilot_invitation.scans");

			const exitCodes = await Promise.all([
				runStateWorker(moduleUrl, statePath),
				runStateWorker(moduleUrl, statePath),
				runStateWorker(moduleUrl, statePath),
			]);

			expect(exitCodes.filter((code) => code === 0)).toHaveLength(1);
			expect(exitCodes.filter((code) => code === 2)).toHaveLength(2);
			expect(fs.readFileSync(statePath, "utf8").trim().split("\n")).toHaveLength(3);
		},
	);
});
