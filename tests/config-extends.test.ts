import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfigChain } from "../src/config/extends.js";

let tmp: string;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-extends-"));
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

const write = (rel: string, body: string): string => {
	const full = path.join(tmp, rel);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, body);
	return full;
};

describe("loadConfigChain", () => {
	it("returns an empty object for an empty file", () => {
		const p = write("empty.yml", "");
		expect(loadConfigChain(p)).toEqual({});
	});

	it("returns the file content when no extends present", () => {
		const p = write("plain.yml", "engines:\n  format: false\nquality:\n  maxFunctionLoc: 50");
		const merged = loadConfigChain(p);
		expect(merged).toEqual({ engines: { format: false }, quality: { maxFunctionLoc: 50 } });
	});

	it("merges a single relative parent (child wins on scalar)", () => {
		write("parent.yml", "engines:\n  format: false\nquality:\n  maxFunctionLoc: 200");
		const child = write(
			"child.yml",
			"extends: ./parent.yml\nquality:\n  maxFunctionLoc: 100",
		);
		const merged = loadConfigChain(child);
		expect(merged).toEqual({
			engines: { format: false },
			quality: { maxFunctionLoc: 100 },
		});
	});

	it("strips the extends key from the merged result", () => {
		write("p.yml", "engines:\n  format: false");
		const c = write("c.yml", "extends: ./p.yml\nquality:\n  maxFunctionLoc: 90");
		const merged = loadConfigChain(c);
		expect(merged.extends).toBeUndefined();
	});

	it("handles array of parents merged left-to-right (last wins)", () => {
		write("a.yml", "quality:\n  maxFunctionLoc: 100\n  maxFileLoc: 100");
		write("b.yml", "quality:\n  maxFunctionLoc: 200");
		const c = write(
			"c.yml",
			"extends:\n  - ./a.yml\n  - ./b.yml\nquality:\n  maxFileLoc: 999",
		);
		const merged = loadConfigChain(c);
		expect(merged.quality).toEqual({ maxFunctionLoc: 200, maxFileLoc: 999 });
	});

	it("deep-merges nested objects but replaces arrays", () => {
		write(
			"p.yml",
			"engines:\n  format: false\n  lint: true\nexclude:\n  - .git\n  - node_modules",
		);
		const c = write("c.yml", "extends: ./p.yml\nengines:\n  format: true\nexclude:\n  - dist");
		const merged = loadConfigChain(c) as {
			engines: Record<string, boolean>;
			exclude: string[];
		};
		expect(merged.engines).toEqual({ format: true, lint: true });
		expect(merged.exclude).toEqual(["dist"]);
	});

	it("detects circular references", () => {
		const a = write("a.yml", "extends: ./b.yml\nx: 1");
		write("b.yml", "extends: ./a.yml\ny: 2");
		expect(() => loadConfigChain(a)).toThrow(/circular extends/);
	});

	it("rejects missing parent file with a helpful error", () => {
		const c = write("c.yml", "extends: ./missing.yml");
		expect(() => loadConfigChain(c)).toThrow(/extends target not found/);
	});

	it("enforces max depth 5", () => {
		for (let i = 0; i < 7; i++) {
			const next = i === 6 ? "" : `extends: ./step-${i + 1}.yml\n`;
			write(`step-${i}.yml`, next);
		}
		expect(() => loadConfigChain(path.join(tmp, "step-0.yml"))).toThrow(
			/depth exceeded/,
		);
	});

	it("rejects URL extends with a clear message", () => {
		const c = write("c.yml", "extends: https://example.com/config.yml");
		expect(() => loadConfigChain(c)).toThrow(/URL-based extends not yet supported/);
	});

	it("rejects bare package-name extends with a clear message", () => {
		const c = write("c.yml", "extends: \"@scanaislop/pack-nextjs\"");
		expect(() => loadConfigChain(c)).toThrow(/Package-name extends not yet supported/);
	});

	it("rejects a malformed extends value", () => {
		const c = write("c.yml", "extends: 123");
		expect(() => loadConfigChain(c)).toThrow(/string or array of strings/);
	});

	it("absolute path target resolves and merges", () => {
		const parentAbs = write("p.yml", "quality:\n  maxFileLoc: 1234");
		const c = write("c.yml", `extends: ${parentAbs}\nquality:\n  maxFunctionLoc: 50`);
		const merged = loadConfigChain(c) as { quality: Record<string, number> };
		expect(merged.quality).toEqual({ maxFileLoc: 1234, maxFunctionLoc: 50 });
	});
});
