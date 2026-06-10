import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	handleAislopBaseline,
	handleAislopFix,
	handleAislopScan,
	handleAislopWhy,
} from "../src/mcp/tools.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const withCwd = async <T>(cwd: string, fn: () => Promise<T> | T): Promise<T> => {
	const original = process.cwd();
	try {
		process.chdir(cwd);
		return await fn();
	} finally {
		process.chdir(original);
	}
};

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-mcp-tools-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("aislop_scan tool", () => {
	it("returns score + counts + findings for an empty project", async () => {
		writeFile("package.json", JSON.stringify({ name: "tiny" }));
		writeFile("src/index.ts", `export const x = 1\n`);

		const result = await withCwd(tmpDir, () => handleAislopScan({ path: "." }));

		expect(typeof result.score).toBe("number");
		expect(result.score).toBeGreaterThanOrEqual(0);
		expect(result.score).toBeLessThanOrEqual(100);
		expect(result.counts).toMatchObject({ error: expect.any(Number), warning: expect.any(Number) });
		expect(result.qualityGate).toMatchObject({
			failBelow: expect.any(Number),
			passed: expect.any(Boolean),
			errorCount: expect.any(Number),
		});
		expect(Array.isArray(result.findings)).toBe(true);
		expect(result.languages.includes("typescript") || result.languages.includes("javascript")).toBe(
			true,
		);
	});

	it("flags a real ai-slop pattern (`as any`) in the scan result", async () => {
		writeFile("package.json", JSON.stringify({ name: "asany" }));
		writeFile(
			"src/bad.ts",
			[`export function pick(input: unknown) {`, `  return (input as any).deep.path`, `}`, ``].join(
				"\n",
			),
		);

		const result = await withCwd(tmpDir, () => handleAislopScan({ path: "." }));

		const matches = result.findings.filter(
			(f) => f.rule === "ai-slop/unsafe-type-assertion" || f.message.includes("as any"),
		);
		expect(matches.length).toBeGreaterThan(0);
	});

	it("defaults the path argument to process.cwd when omitted", async () => {
		const original = process.cwd();
		try {
			process.chdir(tmpDir);
			writeFile("package.json", JSON.stringify({ name: "default-path" }));
			writeFile("src/index.ts", `export const y = 2\n`);
			const result = await handleAislopScan({});
			expect(typeof result.score).toBe("number");
		} finally {
			process.chdir(original);
		}
	});
});

describe("aislop_why tool", () => {
	it("returns an anchor link to /patterns for a known ai-slop rule", () => {
		const result = handleAislopWhy({ rule_id: "ai-slop/narrative-comment" });
		expect(result.id).toBe("ai-slop/narrative-comment");
		expect(result.engine).toBe("ai-slop");
		expect(result.docs).toBe("https://scanaislop.com/patterns#narrative-comment");
		expect(result.hint).toContain("aislop rules");
	});

	it("falls back to /patterns root for an id without a slug", () => {
		const result = handleAislopWhy({ rule_id: "complexity" });
		expect(result.docs).toBe("https://scanaislop.com/patterns");
	});

	it("preserves engine name from any rule prefix (security, complexity, arch)", () => {
		expect(handleAislopWhy({ rule_id: "security/sql-injection" }).engine).toBe("security");
		expect(handleAislopWhy({ rule_id: "complexity/function-too-long" }).engine).toBe("complexity");
		expect(handleAislopWhy({ rule_id: "arch/no-cross-layer-imports" }).engine).toBe("arch");
	});
});

describe("aislop_baseline tool", () => {
	it("returns exists=false with a hint when no baseline exists", async () => {
		const result = await withCwd(tmpDir, () => handleAislopBaseline({ path: "." }));
		expect(result.exists).toBe(false);
		expect("hint" in result ? result.hint : "").toContain("aislop hook baseline");
	});

	it("returns score + lastScanAt when baseline.json is present", async () => {
		const baselineDir = path.join(tmpDir, ".aislop");
		fs.mkdirSync(baselineDir);
		fs.writeFileSync(
			path.join(baselineDir, "baseline.json"),
			JSON.stringify({
				schema: "aislop.baseline.v1",
				updatedAt: "2026-04-19T00:00:00Z",
				score: 87,
				byEngine: { lint: 95 },
				fileCount: 42,
			}),
		);

		const result = await withCwd(tmpDir, () => handleAislopBaseline({ path: "." }));
		expect(result.exists).toBe(true);
		expect("score" in result ? result.score : 0).toBe(87);
		expect("lastScanAt" in result ? result.lastScanAt : "").toBe("2026-04-19T00:00:00Z");
		expect("fileCount" in result ? result.fileCount : 0).toBe(42);
	});
});

describe("MCP path confinement", () => {
	it("rejects scan paths outside the server cwd", async () => {
		const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-mcp-outside-"));
		try {
			await withCwd(tmpDir, async () => {
				await expect(handleAislopScan({ path: outsideDir })).rejects.toThrow(
					/MCP path must stay within the server cwd/,
				);
			});
		} finally {
			fs.rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	it("rejects traversal before the fix tool can spawn a fixer", async () => {
		await withCwd(tmpDir, async () => {
			await expect(handleAislopFix({ path: "..", force: true })).rejects.toThrow(
				/MCP path must stay within the server cwd/,
			);
		});
	});
});
