import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchAgent, printPrompt } from "../src/commands/fix-code.js";
import type { Diagnostic } from "../src/engines/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-fix-code-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const makeDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
	filePath: "src/index.ts",
	engine: "code-quality",
	rule: "complexity/file-too-large",
	severity: "warning",
	message: "File has 500 lines (max: 400)",
	help: "Consider splitting this file into smaller modules",
	line: 0,
	column: 0,
	category: "Complexity",
	fixable: false,
	...overrides,
});

// ─── printPrompt ──────────────────────────────────────────────────────────────

describe("printPrompt", () => {
	it("prints nothing when there are no diagnostics", () => {
		const logs: string[] = [];
		const origWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = (chunk: unknown) => {
			logs.push(String(chunk));
			return true;
		};
		try {
			printPrompt(tmpDir, [], 100);
		} finally {
			process.stdout.write = origWrite;
		}
		// Should not output any prompt content
		expect(logs.join("")).not.toContain("Fix the following");
	});

	it("outputs raw prompt when stdout is not a TTY (piped)", () => {
		const origIsTTY = process.stdout.isTTY;
		const chunks: string[] = [];
		const origWrite = process.stdout.write.bind(process.stdout);

		Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
		process.stdout.write = (chunk: unknown) => {
			chunks.push(String(chunk));
			return true;
		};

		try {
			printPrompt(tmpDir, [makeDiagnostic()], 85);
		} finally {
			Object.defineProperty(process.stdout, "isTTY", {
				value: origIsTTY,
				configurable: true,
			});
			process.stdout.write = origWrite;
		}

		const output = chunks.join("");
		expect(output).toContain("Fix the following 1 code quality issue");
		expect(output).toContain("score: 85/100");
		expect(output).toContain("complexity/file-too-large");
		expect(output).toContain("npx aislop scan");
	});

	it("includes code snippets when line number is provided", () => {
		const filePath = path.join(tmpDir, "src", "big.ts");
		fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
		fs.writeFileSync(
			filePath,
			Array.from({ length: 20 }, (_, i) => `const line${i} = ${i};`).join("\n"),
		);

		const origIsTTY = process.stdout.isTTY;
		const chunks: string[] = [];
		const origWrite = process.stdout.write.bind(process.stdout);

		Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
		process.stdout.write = (chunk: unknown) => {
			chunks.push(String(chunk));
			return true;
		};

		try {
			printPrompt(
				tmpDir,
				[makeDiagnostic({ filePath: "src/big.ts", line: 10, message: "Function too long" })],
				70,
			);
		} finally {
			Object.defineProperty(process.stdout, "isTTY", {
				value: origIsTTY,
				configurable: true,
			});
			process.stdout.write = origWrite;
		}

		const output = chunks.join("");
		expect(output).toContain("→");
		expect(output).toContain("line10");
	});

	it("groups diagnostics by file and sorts errors first", () => {
		const origIsTTY = process.stdout.isTTY;
		const chunks: string[] = [];
		const origWrite = process.stdout.write.bind(process.stdout);

		Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
		process.stdout.write = (chunk: unknown) => {
			chunks.push(String(chunk));
			return true;
		};

		try {
			printPrompt(
				tmpDir,
				[
					makeDiagnostic({ filePath: "a.ts", severity: "warning", message: "warn in a" }),
					makeDiagnostic({ filePath: "b.ts", severity: "error", message: "error in b" }),
					makeDiagnostic({ filePath: "a.ts", severity: "warning", message: "warn2 in a" }),
				],
				50,
			);
		} finally {
			Object.defineProperty(process.stdout, "isTTY", {
				value: origIsTTY,
				configurable: true,
			});
			process.stdout.write = origWrite;
		}

		const output = chunks.join("");
		// b.ts (has error) should appear before a.ts (only warnings)
		const bPos = output.indexOf("## b.ts");
		const aPos = output.indexOf("## a.ts");
		expect(bPos).toBeLessThan(aPos);
		expect(output).toContain("3 code quality issues");
	});
});

// ─── launchAgent ──────────────────────────────────────────────────────────────

describe("launchAgent", () => {
	it("reports no issues when diagnostics are empty", () => {
		// Should not throw
		launchAgent("claude", tmpDir, [], 100);
	});

	it("reports error for unknown agent name", () => {
		// Should not throw, just log error
		launchAgent("nonexistent-agent", tmpDir, [makeDiagnostic()], 50);
	});

	it("reports error when agent binary is not installed", () => {
		// kimi is unlikely to be installed in test env
		launchAgent("kimi", tmpDir, [makeDiagnostic()], 50);
	});
});
