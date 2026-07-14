import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	appendSessionFiles,
	baselinePath,
	clearSessionFiles,
	readBaseline,
	readSessionFiles,
	writeBaseline,
} from "../../src/hooks/quality-gate/baseline.js";

let cwd: string;

beforeEach(() => {
	cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-baseline-"));
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(cwd, { recursive: true, force: true });
});

describe("baseline read/write", () => {
	it("round-trips a v2 baseline (incl. findingFingerprints) to .aislop/baseline.json", () => {
		writeBaseline(cwd, {
			schema: "aislop.baseline.v2",
			updatedAt: "2026-04-19T00:00:00Z",
			score: 87,
			byEngine: { lint: 95 },
			fileCount: 42,
			findingFingerprints: ["src/x.ts:10:ai-slop/foo"],
		});
		const read = readBaseline(cwd);
		expect(read?.score).toBe(87);
		expect(read?.findingFingerprints).toEqual(["src/x.ts:10:ai-slop/foo"]);
		expect(baselinePath(cwd)).toBe(path.join(cwd, ".aislop", "baseline.json"));
	});

	it("normalises legacy backslash fingerprints from a pre-POSIX Windows baseline", () => {
		// Before fingerprints were POSIX-normalized, a Windows capture stored backslash
		// paths. On read they must convert to forward slashes so they match the
		// fingerprints produced now, otherwise every prior finding looks new after upgrade.
		fs.mkdirSync(path.join(cwd, ".aislop"));
		fs.writeFileSync(
			path.join(cwd, ".aislop", "baseline.json"),
			JSON.stringify({
				schema: "aislop.baseline.v2",
				updatedAt: "2026-03-01T00:00:00Z",
				score: 80,
				byEngine: { lint: 90 },
				fileCount: 30,
				findingFingerprints: ["src\\utils\\x.ts:10:ai-slop/foo"],
			}),
		);
		vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
		const read = readBaseline(cwd);
		expect(read?.findingFingerprints).toEqual(["src/utils/x.ts:10:ai-slop/foo"]);
	});

	it("preserves an existing literal backslash path in a markerless POSIX baseline", () => {
		const literalPath = path.join(cwd, "src", "foo\\bar.ts");
		fs.mkdirSync(path.dirname(literalPath), { recursive: true });
		fs.writeFileSync(literalPath, "export const value = 1;\n");
		fs.mkdirSync(path.join(cwd, ".aislop"));
		fs.writeFileSync(
			path.join(cwd, ".aislop", "baseline.json"),
			JSON.stringify({
				schema: "aislop.baseline.v2",
				findingFingerprints: ["src/foo\\bar.ts:10:ai-slop/foo"],
			}),
		);
		vi.spyOn(process, "platform", "get").mockReturnValue("darwin");

		const read = readBaseline(cwd);
		expect(read?.findingFingerprints).toEqual(["src/foo\\bar.ts:10:ai-slop/foo"]);
	});

	it.runIf(process.platform !== "win32")(
		"does not trust a literal-backslash symlink that resolves outside the project",
		() => {
			const outsideFile = path.join(os.tmpdir(), `aislop-baseline-outside-${Date.now()}.ts`);
			const symlinkPath = path.join(cwd, "src", "probe\\name.ts");
			try {
				fs.writeFileSync(outsideFile, "export const outside = true;\n");
				fs.mkdirSync(path.dirname(symlinkPath), { recursive: true });
				fs.symlinkSync(outsideFile, symlinkPath);
				fs.mkdirSync(path.join(cwd, ".aislop"));
				fs.writeFileSync(
					path.join(cwd, ".aislop", "baseline.json"),
					JSON.stringify({
						schema: "aislop.baseline.v2",
						findingFingerprints: ["src/probe\\name.ts:10:ai-slop/foo"],
					}),
				);

				const read = readBaseline(cwd);
				expect(read?.findingFingerprints).toEqual(["src/probe/name.ts:10:ai-slop/foo"]);
			} finally {
				fs.rmSync(outsideFile, { force: true });
			}
		},
	);

	it("preserves a valid POSIX filename containing a backslash", () => {
		writeBaseline(cwd, {
			schema: "aislop.baseline.v2",
			updatedAt: "2026-04-19T00:00:00Z",
			score: 87,
			byEngine: { lint: 95 },
			fileCount: 1,
			findingFingerprints: ["src/foo\\bar.ts:10:ai-slop/foo"],
		});

		const read = readBaseline(cwd);
		expect(read?.findingFingerprints).toEqual(["src/foo\\bar.ts:10:ai-slop/foo"]);
	});

	it("reads a legacy v1 baseline and normalises to v2 with empty fingerprints", () => {
		fs.mkdirSync(path.join(cwd, ".aislop"));
		fs.writeFileSync(
			path.join(cwd, ".aislop", "baseline.json"),
			JSON.stringify({
				schema: "aislop.baseline.v1",
				updatedAt: "2026-03-01T00:00:00Z",
				score: 75,
				byEngine: { lint: 90 },
				fileCount: 30,
			}),
		);
		const read = readBaseline(cwd);
		expect(read?.schema).toBe("aislop.baseline.v2");
		expect(read?.score).toBe(75);
		expect(read?.findingFingerprints).toEqual([]);
	});

	it("returns null for missing or invalid baseline", () => {
		expect(readBaseline(cwd)).toBeNull();
		fs.mkdirSync(path.join(cwd, ".aislop"));
		fs.writeFileSync(path.join(cwd, ".aislop", "baseline.json"), "{not json");
		expect(readBaseline(cwd)).toBeNull();
	});

	it("returns null when schema is missing or unknown", () => {
		fs.mkdirSync(path.join(cwd, ".aislop"));
		fs.writeFileSync(
			path.join(cwd, ".aislop", "baseline.json"),
			JSON.stringify({ schema: "aislop.baseline.v999", score: 80 }),
		);
		expect(readBaseline(cwd)).toBeNull();
	});
});

describe("session file accumulation", () => {
	it("appends and reads back unique files across calls", () => {
		appendSessionFiles(cwd, ["/abs/a.ts"]);
		appendSessionFiles(cwd, ["/abs/a.ts", "/abs/b.ts"]);
		const files = readSessionFiles(cwd);
		expect(files.sort()).toEqual(["/abs/a.ts", "/abs/b.ts"]);
	});

	it("clearSessionFiles wipes the log", () => {
		appendSessionFiles(cwd, ["/abs/a.ts"]);
		clearSessionFiles(cwd);
		expect(readSessionFiles(cwd)).toEqual([]);
	});
});
