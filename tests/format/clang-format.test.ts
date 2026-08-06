import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import {
	chunkFilePaths,
	fixClangFormat,
	hasClangFormatConfig,
	parseClangFormatViolations,
	runClangFormat,
} from "../../src/engines/format/clang-format.js";
import type { EngineContext } from "../../src/engines/types.js";

const { runSubprocess } = vi.hoisted(() => ({ runSubprocess: vi.fn() }));

// Only the spawn is stubbed; chunkFilePaths stays real so the pooled paths below
// are driven by the same chunk boundaries production uses.
vi.mock("../../src/utils/subprocess.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/utils/subprocess.js")>();
	return { ...actual, runSubprocess };
});

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-clang-format-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const makeContext = (
	rootDirectory: string,
	overrides: Partial<EngineContext> = {},
): EngineContext => ({
	rootDirectory,
	languages: ["cpp"],
	frameworks: [],
	installedTools: { "clang-format": true },
	config: {
		quality: DEFAULT_CONFIG.quality,
		security: DEFAULT_CONFIG.security,
		lint: DEFAULT_CONFIG.lint,
	},
	...overrides,
});

describe("hasClangFormatConfig", () => {
	it("detects a .clang-format file", () => {
		fs.writeFileSync(path.join(tmpDir, ".clang-format"), "BasedOnStyle: Google\n");
		expect(hasClangFormatConfig(tmpDir)).toBe(true);
	});

	it("detects a _clang-format file", () => {
		fs.writeFileSync(path.join(tmpDir, "_clang-format"), "BasedOnStyle: LLVM\n");
		expect(hasClangFormatConfig(tmpDir)).toBe(true);
	});

	it("returns false when no config is present", () => {
		fs.mkdirSync(path.join(tmpDir, "src"));
		fs.writeFileSync(path.join(tmpDir, "src", "a.cpp"), "int a;\n");
		expect(hasClangFormatConfig(tmpDir)).toBe(false);
	});
});

describe("runClangFormat", () => {
	it("returns [] when no .clang-format is present", async () => {
		fs.mkdirSync(path.join(tmpDir, "src"));
		fs.writeFileSync(path.join(tmpDir, "src", "a.cpp"), "int  a ;\n");
		const context = makeContext(tmpDir);
		expect(await runClangFormat(context)).toEqual([]);
	});
});

describe("chunkFilePaths", () => {
	it("puts everything in one chunk when well under both limits", () => {
		const files = ["a.cpp", "b.cpp", "c.cpp"];
		expect(chunkFilePaths(files, 200, 25000)).toEqual([files]);
	});

	it("splits once the file-count cap is hit", () => {
		const files = Array.from({ length: 5 }, (_, i) => `f${i}.cpp`);
		const chunks = chunkFilePaths(files, 2, 25000);
		expect(chunks).toEqual([["f0.cpp", "f1.cpp"], ["f2.cpp", "f3.cpp"], ["f4.cpp"]]);
	});

	it("splits once the character budget is hit", () => {
		// Each path is 10 chars + 1 separator = 11; a budget of 25 fits two per chunk.
		const files = ["aaaaaaaa.c", "bbbbbbbb.c", "cccccccc.c", "dddddddd.c"];
		const chunks = chunkFilePaths(files, 200, 25);
		expect(chunks).toEqual([
			["aaaaaaaa.c", "bbbbbbbb.c"],
			["cccccccc.c", "dddddddd.c"],
		]);
	});

	it("gives an over-budget lone file its own chunk instead of dropping it", () => {
		const hugePath = "x".repeat(100);
		const files = [hugePath, "short.cpp"];
		const chunks = chunkFilePaths(files, 200, 25);
		expect(chunks).toEqual([[hugePath], ["short.cpp"]]);
	});

	it("returns [] for an empty file list", () => {
		expect(chunkFilePaths([])).toEqual([]);
	});
});

describe("parseClangFormatViolations", () => {
	it("extracts each distinct flagged file from a multi-file dry-run report", () => {
		const stderr = [
			"bad1.cpp:1:4: error: code should be clang-formatted [-Wclang-format-violations]",
			"int   a=1;",
			"   ^",
			"bad1.cpp:2:6: error: code should be clang-formatted [-Wclang-format-violations]",
			"int b=2;",
			"     ^",
			"bad2.cpp:1:4: error: code should be clang-formatted [-Wclang-format-violations]",
			"int   c=3;",
			"   ^",
		].join("\n");
		expect(parseClangFormatViolations(stderr)).toEqual(new Set(["bad1.cpp", "bad2.cpp"]));
	});

	it("handles a Windows absolute path whose drive letter contains a colon", () => {
		const stderr =
			"C:\\repo\\src\\bad.cpp:1:4: error: code should be clang-formatted [-Wclang-format-violations]\nint   a=1;\n   ^";
		expect(parseClangFormatViolations(stderr)).toEqual(new Set(["C:\\repo\\src\\bad.cpp"]));
	});

	it("returns an empty set when there is no violation line", () => {
		expect(parseClangFormatViolations("")).toEqual(new Set());
		expect(parseClangFormatViolations("doesnotexist.cpp: no such file or directory")).toEqual(
			new Set(),
		);
	});
});

// 450 sources split into 3 chunks under the shared 200-file cap, enough to have
// chunks complete out of order while the pool is still holding others back.
const SOURCE_COUNT = 450;
const CHUNK_COUNT = 3;
const POOL_WIDTH = Math.max(1, os.availableParallelism() - 2);

const sleep = (milliseconds: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

const writeSources = (rootDirectory: string): void => {
	fs.writeFileSync(path.join(rootDirectory, ".clang-format"), "BasedOnStyle: Google\n");
	fs.mkdirSync(path.join(rootDirectory, "src"), { recursive: true });
	for (let index = 0; index < SOURCE_COUNT; index += 1) {
		const name = `f${String(index).padStart(3, "0")}.cpp`;
		fs.writeFileSync(path.join(rootDirectory, "src", name), "int  a ;\n");
	}
};

// The file paths a chunk invocation was given, i.e. everything after the `--`
// sentinel that separates clang-format's options from its positional args.
const chunkFilesOf = (args: string[]): string[] => args.slice(args.indexOf("--") + 1);

const violationReport = (files: string[]): string =>
	files
		.map((file) => `${file}:1:4: error: code should be clang-formatted [-Wclang-format-violations]`)
		.join("\n");

describe("runClangFormat - pooled chunk execution", () => {
	// The pooled tests mock runSubprocess entirely, so the 450-file source
	// tree is read-only and can be written once per describe. Rewriting it
	// per test blew the 10s hook timeout on loaded Windows CI runners.
	let pooledSourceDir: string;

	beforeAll(() => {
		pooledSourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-clang-format-pool-"));
		writeSources(pooledSourceDir);
	}, 120_000);

	afterAll(() => {
		fs.rmSync(pooledSourceDir, { recursive: true, force: true });
	});

	beforeEach(() => {
		runSubprocess.mockReset();
	});

	it("caps concurrent clang-format invocations at the pool width", async () => {
		let inFlight = 0;
		let peakInFlight = 0;
		runSubprocess.mockImplementation(async () => {
			inFlight += 1;
			peakInFlight = Math.max(peakInFlight, inFlight);
			await sleep(25);
			inFlight -= 1;
			return { stdout: "", stderr: "", exitCode: 0 };
		});

		await runClangFormat(makeContext(pooledSourceDir));

		expect(runSubprocess).toHaveBeenCalledTimes(CHUNK_COUNT);
		expect(peakInFlight).toBe(Math.min(POOL_WIDTH, CHUNK_COUNT));
	});

	it("produces identical diagnostics no matter which chunk finishes first", async () => {
		const scanWithDelays = async (delayForCall: (callIndex: number) => number) => {
			let callIndex = 0;
			runSubprocess.mockImplementation(async (_command: string, args: string[]) => {
				const delay = delayForCall(callIndex);
				callIndex += 1;
				const files = chunkFilesOf(args);
				await sleep(delay);
				return { stdout: "", stderr: violationReport(files), exitCode: 1 };
			});
			return runClangFormat(makeContext(pooledSourceDir));
		};

		const firstChunkLast = await scanWithDelays((callIndex) => (CHUNK_COUNT - callIndex) * 15);
		const firstChunkFirst = await scanWithDelays((callIndex) => (callIndex + 1) * 15);

		expect(firstChunkLast).toEqual(firstChunkFirst);
		expect(firstChunkLast).toHaveLength(SOURCE_COUNT);
		expect(firstChunkLast.map((diagnostic) => diagnostic.filePath).sort()).toEqual(
			Array.from(
				{ length: SOURCE_COUNT },
				(_, index) => `src/f${String(index).padStart(3, "0")}.cpp`,
			),
		);
	});
});

describe("fixClangFormat - pooled chunk execution", () => {
	let pooledSourceDir: string;

	beforeAll(() => {
		pooledSourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-clang-format-fixpool-"));
		writeSources(pooledSourceDir);
	}, 120_000);

	afterAll(() => {
		fs.rmSync(pooledSourceDir, { recursive: true, force: true });
	});

	beforeEach(() => {
		runSubprocess.mockReset();
	});

	it("rethrows the lowest-index chunk failure after every in-flight chunk has finished", async () => {
		const completedCalls: number[] = [];
		let callIndex = 0;
		// Chunks are claimed in index order, so the nth call is the nth chunk.
		// Chunk 2 fails first in wall-clock time; chunk 1's error must still win.
		runSubprocess.mockImplementation(async () => {
			const index = callIndex;
			callIndex += 1;
			await sleep(index === 1 ? 30 : 5);
			completedCalls.push(index);
			if (index === 0) return { stdout: "", stderr: "", exitCode: 0 };
			return { stdout: "", stderr: `chunk ${index} exploded`, exitCode: 1 };
		});

		await expect(fixClangFormat(pooledSourceDir)).rejects.toThrow("chunk 1 exploded");

		expect(runSubprocess).toHaveBeenCalledTimes(CHUNK_COUNT);
		expect(completedCalls.sort()).toEqual([0, 1, 2]);
		expect((runSubprocess.mock.calls[0][1] as string[]).slice(0, 2)).toEqual(["-i", "--"]);
	});
});
