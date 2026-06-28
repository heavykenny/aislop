import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDuplicateBlocks } from "../../src/engines/code-quality/duplicate-block.js";
import type { EngineContext } from "../../src/engines/types.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-dup-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ctx = (rootDirectory: string): EngineContext => ({
	rootDirectory,
	languages: ["typescript"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: true, auditTimeout: 25000 },
	},
});

const write = (relative: string, content: string): void => {
	const full = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
};

describe("duplicate-block", () => {
	it("flags a 10-line block that appears twice in the same file", async () => {
		write(
			"a.ts",
			`export const runA = async (dir: string) => {
	const config = loadConfig(dir);
	const result = await scanCommand(dir, config, opts);
	if (result.exitCode !== 0) {
		await flushTelemetry();
		process.exit(result.exitCode);
	}
	const report = await buildReport(result, dir);
	await writeReport(report, "a");
	await report({ status: "done" });
	return result;
};

export const runB = async (dir: string) => {
	const config = loadConfig(dir);
	const result = await scanCommand(dir, config, opts);
	if (result.exitCode !== 0) {
		await flushTelemetry();
		process.exit(result.exitCode);
	}
	const report = await buildReport(result, dir);
	await writeReport(report, "b");
	await report({ status: "done" });
	return result;
};
`,
		);
		const diags = await detectDuplicateBlocks(ctx(tmpDir));
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].rule).toBe("code-quality/duplicate-block");
		expect(diags[0].detail).toMatch(/duplicate block/);
	});

	it("does not flag a single non-duplicated block", async () => {
		write(
			"b.ts",
			`export const only = (dir: string) => {
	const config = loadConfig(dir);
	const result = scanCommand(dir, config);
	if (result.exitCode !== 0) {
		flushTelemetry();
		process.exit(1);
	}
};
`,
		);
		const diags = await detectDuplicateBlocks(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("does not flag structurally similar but identifier-distinct blocks (keeps noise low)", async () => {
		write(
			"c.ts",
			`const one = fetch(urlA);
one.then(handleA);
one.catch(errorA);
one.finally(cleanupA);
one.abort();

const two = fetch(urlB);
two.then(handleB);
two.catch(errorB);
two.finally(cleanupB);
two.abort();
`,
		);
		const diags = await detectDuplicateBlocks(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("does not flag repeated SVG path markup as duplicate logic", async () => {
		write(
			"icons.tsx",
			`export const IconA = () => (
	<svg viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M0 0h10v10H0z" fill="currentColor" fill-opacity="0.9" />
		<path d="M1 1h8v8H1z" stroke="currentColor" stroke-width="2" />
		<line x1="0" x2="10" y1="5" y2="5" stroke="currentColor" />
		<polyline points="1 1 5 5 9 1" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
);

export const IconB = () => (
	<svg viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M0 0h10v10H0z" fill="currentColor" fill-opacity="0.9" />
		<path d="M1 1h8v8H1z" stroke="currentColor" stroke-width="2" />
		<line x1="0" x2="10" y1="5" y2="5" stroke="currentColor" />
		<polyline points="1 1 5 5 9 1" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
);
`,
		);
		const diags = await detectDuplicateBlocks(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("does not flag static SVG component files as duplicate logic", async () => {
		write(
			"components/common/company_svg.tsx",
			`export const CompanySvg = () => {
	const attrs = {
		fill: "currentColor",
		stroke: "none",
		viewBox: "0 0 10 10",
		role: "img",
		focusable: "false",
		width: 10,
		height: 10,
	};
	return <svg {...attrs}><path d="M0 0h10v10H0z" /></svg>;
};

export const TeamSvg = () => {
	const attrs = {
		fill: "currentColor",
		stroke: "none",
		viewBox: "0 0 10 10",
		role: "img",
		focusable: "false",
		width: 10,
		height: 10,
	};
	return <svg {...attrs}><path d="M1 1h8v8H1z" /></svg>;
};
`,
		);

		const diags = await detectDuplicateBlocks(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("does not flag repeated data literal records as duplicate logic", async () => {
		write(
			"data.ts",
			`export const testimonials = [
	{
		name: "Steven",
		handle: "@steven",
		image: "/steven.jpg",
		content: "Great product",
		url: "https://example.com/a",
	},
	{
		name: "Olivia",
		handle: "@olivia",
		image: "/olivia.jpg",
		content: "Still great",
		url: "https://example.com/b",
	},
	{
		name: "Jaisal",
		handle: "@jaisal",
		image: "/jaisal.jpg",
		content: "Useful tool",
		url: "https://example.com/c",
	},
];
`,
		);
		const diags = await detectDuplicateBlocks(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("does not flag purely boilerplate trivial lines like closing braces", async () => {
		write(
			"d.ts",
			`export const one = () => {
};

export const two = () => {
};

export const three = () => {
};
`,
		);
		const diags = await detectDuplicateBlocks(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});

	it("does not flag TypeScript declaration overloads as duplicate implementation blocks", async () => {
		write(
			"index.d.ts",
			`export declare function createSelector<S, R1, T>(
	selector1: Selector<S, R1>,
	combiner: (res1: R1) => T,
): OutputSelector<S, T>;
export declare function createSelector<S, R1, R2, T>(
	selector1: Selector<S, R1>,
	selector2: Selector<S, R2>,
	combiner: (res1: R1, res2: R2) => T,
): OutputSelector<S, T>;
export declare function createSelector<S, R1, R2, R3, T>(
	selector1: Selector<S, R1>,
	selector2: Selector<S, R2>,
	selector3: Selector<S, R3>,
	combiner: (res1: R1, res2: R2, res3: R3) => T,
): OutputSelector<S, T>;
export declare function createSelector<S, R1, R2, R3, R4, T>(
	selector1: Selector<S, R1>,
	selector2: Selector<S, R2>,
	selector3: Selector<S, R3>,
	selector4: Selector<S, R4>,
	combiner: (res1: R1, res2: R2, res3: R3, res4: R4) => T,
): OutputSelector<S, T>;
`,
		);
		const diags = await detectDuplicateBlocks(ctx(tmpDir));
		expect(diags).toHaveLength(0);
	});
});
