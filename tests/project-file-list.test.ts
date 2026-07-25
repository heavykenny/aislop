import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	enumerateProjectFiles,
	enumerateProjectFilesFromDisk,
} from "../src/utils/project-file-list.js";

const writeFile = (rootDirectory: string, relativePath: string): void => {
	const filePath = path.join(rootDirectory, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, "export {};\n", "utf-8");
};

describe("project file enumeration", () => {
	let rootDirectory: string;

	beforeEach(() => {
		rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-project-files-"));
	});

	afterEach(() => {
		fs.rmSync(rootDirectory, { recursive: true, force: true });
	});

	it("prunes tracked and untracked directories from git enumeration", () => {
		execFileSync("git", ["init"], { cwd: rootDirectory, stdio: "ignore" });
		writeFile(rootDirectory, "src/app.ts");
		writeFile(rootDirectory, "vendor/tracked.ts");
		writeFile(rootDirectory, "dist/untracked.js");
		execFileSync("git", ["add", "-f", "src/app.ts", "vendor/tracked.ts"], {
			cwd: rootDirectory,
			stdio: "ignore",
		});

		expect(enumerateProjectFiles(rootDirectory, new Set(["dist", "vendor"]))).toEqual([
			"src/app.ts",
		]);
	});

	it("does not follow directory symlinks or junctions during disk enumeration", () => {
		const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-project-outside-"));
		try {
			writeFile(rootDirectory, "src/app.ts");
			writeFile(outsideDirectory, "escaped.ts");
			fs.symlinkSync(
				outsideDirectory,
				path.join(rootDirectory, "linked"),
				process.platform === "win32" ? "junction" : "dir",
			);

			expect(enumerateProjectFilesFromDisk(rootDirectory, new Set())).toEqual(["src/app.ts"]);
		} finally {
			fs.rmSync(outsideDirectory, { recursive: true, force: true });
		}
	});
});
