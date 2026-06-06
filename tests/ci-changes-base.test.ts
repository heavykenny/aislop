import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });

const write = (root: string, rel: string, body: string) => {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, body, "utf-8");
};

const runCli = (args: string[]) =>
	spawnSync(process.execPath, [path.resolve("dist/cli.js"), ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			AISLOP_NO_TELEMETRY: "1",
			DO_NOT_TRACK: "1",
			CI: "1",
			NO_COLOR: "1",
		},
		maxBuffer: 20 * 1024 * 1024,
	});

const rulesOf = (stdout: string): string[] => {
	const parsed = JSON.parse(stdout) as { diagnostics?: Array<{ rule: string }> };
	return (parsed.diagnostics ?? []).map((d) => d.rule);
};

const SECRET = 'export const api_key = "abcdefghijklmnopqrstuvwxyz0";\n';
const CLEAN = "export const sum = (a: number, b: number): number => a + b;\n";

describe("ci --changes --base", () => {
	let tmpDir: string;
	let baseSha: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-ci-base-"));
		git(tmpDir, ["init"]);
		git(tmpDir, ["config", "user.email", "test@example.com"]);
		git(tmpDir, ["config", "user.name", "test"]);
		git(tmpDir, ["config", "commit.gpgsign", "false"]);
		write(tmpDir, "tainted.ts", SECRET);
		git(tmpDir, ["add", "."]);
		git(tmpDir, ["commit", "-m", "base", "--no-verify"]);
		baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: tmpDir,
			encoding: "utf8",
		}).trim();
		git(tmpDir, ["checkout", "-b", "feature"]);
		write(tmpDir, "clean.ts", CLEAN);
		git(tmpDir, ["add", "."]);
		git(tmpDir, ["commit", "-m", "feat", "--no-verify"]);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("scopes to files changed vs the base ref, skipping base-branch slop", () => {
		const scoped = runCli(["ci", tmpDir, "--changes", "--base", baseSha, "--json"]);
		expect(rulesOf(scoped.stdout)).not.toContain("security/hardcoded-secret");
	});

	it("a full scan of the same repo still flags the base-branch slop", () => {
		const full = runCli(["scan", tmpDir, "--json"]);
		expect(rulesOf(full.stdout)).toContain("security/hardcoded-secret");
	});

	it("fails loudly when an explicit --base ref cannot be resolved", () => {
		const res = runCli(["ci", tmpDir, "--changes", "--base", "origin/does-not-exist", "--json"]);
		expect(res.status).not.toBe(0);
		const parsed = JSON.parse(res.stdout) as { error?: string };
		expect(parsed.error).toMatch(/does-not-exist/);
	});
});
