import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
	fs.rmSync(cwd, { recursive: true, force: true });
});

describe("baseline read/write", () => {
	it("round-trips a baseline to .aislop/baseline.json", () => {
		writeBaseline(cwd, {
			schema: "aislop.baseline.v1",
			updatedAt: "2026-04-19T00:00:00Z",
			score: 87,
			byEngine: { lint: 95 },
			fileCount: 42,
		});
		const read = readBaseline(cwd);
		expect(read?.score).toBe(87);
		expect(baselinePath(cwd)).toBe(path.join(cwd, ".aislop", "baseline.json"));
	});

	it("returns null for missing or invalid baseline", () => {
		expect(readBaseline(cwd)).toBeNull();
		fs.mkdirSync(path.join(cwd, ".aislop"));
		fs.writeFileSync(path.join(cwd, ".aislop", "baseline.json"), "{not json");
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
