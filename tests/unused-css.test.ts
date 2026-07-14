import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectUnusedCss } from "../src/engines/ai-slop/unused-css.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): string => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content, "utf-8");
	return absolute;
};

// Use a whole-root scan (no explicit `files`) so getSourceFilesWithExtras walks
// the tree and discovers both stylesheets and reference files together.
const buildContext = (): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["typescript"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-unused-css-"));
	// git ls-files is used for discovery; init a repo so the walker sees the files.
	spawnSync("git", ["init", "-q"], { cwd: tmpDir });
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const unused = (diags: Awaited<ReturnType<typeof detectUnusedCss>>) =>
	diags.filter((d) => d.rule === "ai-slop/unused-css");

describe("ai-slop/unused-css", () => {
	it("does NOT flag a class that is defined and used in a className string", async () => {
		writeFile("src/index.css", ".card { padding: 8px; }\n");
		writeFile("src/App.tsx", `export const A = () => <div className="card" />;\n`);

		const diags = unused(await detectUnusedCss(buildContext()));
		expect(diags).toHaveLength(0);
	});

	it("flags a class that is defined but referenced nowhere", async () => {
		writeFile("src/index.css", ".card { padding: 8px; }\n.table-row { display: flex; }\n");
		writeFile("src/App.tsx", `export const A = () => <div className="card" />;\n`);

		const diags = unused(await detectUnusedCss(buildContext()));
		expect(diags).toHaveLength(1);
		const [d] = diags;
		expect(d.rule).toBe("ai-slop/unused-css");
		expect(d.severity).toBe("warning");
		expect(d.message).toContain("table-row");
		expect(d.line).toBe(2);
		expect(d.filePath).toBe("src/index.css");
	});

	it("does NOT flag a class referenced only via a dynamic/interpolated prefix (false-positive guard)", async () => {
		writeFile(
			"src/index.css",
			[".ui-toggle { color: red; }", ".ui-panel { color: blue; }", ""].join("\n"),
		);
		// The class names never appear in full — only the `ui-` prefix does, inside a
		// template literal. Conservative substring matching must spare both classes.
		writeFile(
			"src/dynamic.tsx",
			[
				"export const C = ({ kind }: { kind: string }) => (",
				"  <div className={`ui-${kind}`} />",
				");",
				"",
			].join("\n"),
		);

		const diags = unused(await detectUnusedCss(buildContext()));
		expect(diags).toHaveLength(0);
	});

	it("does NOT flag Tailwind-looking utility classes even when undefined elsewhere", async () => {
		writeFile(
			"src/index.css",
			[
				".flex { display: flex; }",
				".mt-4 { margin-top: 1rem; }",
				".text-red-500 { color: red; }",
				".hover\\:bg-blue-500:hover { background: blue; }",
				"",
			].join("\n"),
		);
		writeFile("src/App.tsx", `export const A = () => <div />;\n`);

		const diags = unused(await detectUnusedCss(buildContext()));
		expect(diags).toHaveLength(0);
	});

	it("treats cn()/clsx() argument strings as references", async () => {
		writeFile("src/index.css", ".btn-primary { color: white; }\n");
		writeFile(
			"src/Button.tsx",
			[
				`import { cn } from "./cn";`,
				`export const B = () => <button className={cn("btn-primary")} />;`,
				"",
			].join("\n"),
		);

		const diags = unused(await detectUnusedCss(buildContext()));
		expect(diags).toHaveLength(0);
	});

	it("counts references inside HTML files", async () => {
		writeFile("styles.css", ".hero { font-size: 2rem; }\n");
		writeFile("index.html", `<section class="hero">Hi</section>\n`);

		const diags = unused(await detectUnusedCss(buildContext()));
		expect(diags).toHaveLength(0);
	});

	it("does not count a class's own selector as a reference (cross-stylesheet)", async () => {
		// Two stylesheets, one defines `.lonely`, nothing uses it. The selector token
		// in its own file must not register as a reference.
		writeFile("a.css", ".lonely { color: red; }\n");
		writeFile("b.css", ".used { color: blue; }\n");
		writeFile("page.tsx", `export const P = () => <div className="used" />;\n`);

		const diags = unused(await detectUnusedCss(buildContext()));
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("lonely");
	});

	it("collects classes from grouped selectors and reports each unused one", async () => {
		writeFile("src/index.css", ".alpha,\n.beta { color: red; }\n");
		writeFile("src/App.tsx", `export const A = () => <div className="alpha" />;\n`);

		const diags = unused(await detectUnusedCss(buildContext()));
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain("beta");
	});

	it("returns nothing when there are no stylesheets", async () => {
		writeFile("src/App.tsx", `export const A = () => <div className="card" />;\n`);
		const diags = unused(await detectUnusedCss(buildContext()));
		expect(diags).toHaveLength(0);
	});
});
