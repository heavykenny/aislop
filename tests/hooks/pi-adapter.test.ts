import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatPiMessage, parsePiStdin, runPiHook } from "../../src/hooks/adapters/pi.js";
import type { AislopFeedback } from "../../src/hooks/feedback.js";

const baseFeedback = (overrides: Partial<AislopFeedback> = {}): AislopFeedback => ({
	schema: "aislop.hook.v2",
	score: 100,
	regressed: false,
	counts: { error: 0, warning: 0, fixable: 0, total: 0 },
	findings: [],
	nextSteps: [],
	suggestedActions: [],
	...overrides,
});

describe("parsePiStdin", () => {
	it("returns {} for empty or whitespace input", () => {
		expect(parsePiStdin("")).toEqual({});
		expect(parsePiStdin("   ")).toEqual({});
	});

	it("returns {} for malformed JSON", () => {
		expect(parsePiStdin("not json")).toEqual({});
	});

	it("parses a tool_result payload from the pi extension", () => {
		const parsed = parsePiStdin(
			JSON.stringify({ cwd: "/repo", file_path: "/repo/src/a.ts", tool_name: "edit" }),
		);
		expect(parsed.cwd).toBe("/repo");
		expect(parsed.file_path).toBe("/repo/src/a.ts");
		expect(parsed.tool_name).toBe("edit");
	});
});

describe("formatPiMessage", () => {
	it("returns an empty string when the file is clean", () => {
		expect(formatPiMessage(baseFeedback())).toBe("");
	});

	it("summarises score, counts, and each finding", () => {
		const message = formatPiMessage(
			baseFeedback({
				score: 82,
				baseline: 100,
				counts: { error: 1, warning: 1, fixable: 0, total: 2 },
				findings: [
					{
						ruleId: "security/eval",
						severity: "error",
						category: "Security",
						file: "src/a.ts",
						line: 12,
						message: "eval() is dangerous",
					},
					{
						ruleId: "ai-slop/trivial-comment",
						severity: "warning",
						category: "Comments",
						file: "src/a.ts",
						line: 3,
						message: "Trivial comment",
					},
				],
				nextSteps: ["Run `npx aislop fix`."],
			}),
		);
		expect(message).toContain("aislop: score 82/100 (baseline 100)");
		expect(message).toContain("1 error, 1 warning");
		expect(message).toContain("src/a.ts:12 [error] security/eval: eval() is dangerous");
		expect(message).toContain("src/a.ts:3 [warning] ai-slop/trivial-comment");
		expect(message).toContain("Run `npx aislop fix`.");
	});
});

describe("runPiHook (integration)", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-pi-"));
	});

	afterEach(() => {
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it("emits a v2 envelope and does not block on a clean file", async () => {
		const file = path.join(cwd, "clean.ts");
		fs.writeFileSync(file, "export const add = (a: number, b: number): number => a + b;\n");

		let written = "";
		const code = await runPiHook({
			stdin: async () => JSON.stringify({ cwd, file_path: file }),
			write: (s) => {
				written += s;
			},
		});

		expect(code).toBe(0);
		const out = JSON.parse(written);
		expect(out.schema).toBe("aislop.hook.v2");
		expect(out.block).toBe(false);
		expect(out.message).toBe("");
	});

	it("returns 0 without writing when no file path is supplied", async () => {
		let written = "";
		const code = await runPiHook({
			stdin: async () => JSON.stringify({ cwd }),
			write: (s) => {
				written += s;
			},
		});
		expect(code).toBe(0);
		expect(written).toBe("");
	});
});
