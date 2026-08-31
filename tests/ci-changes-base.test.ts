import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixCommand } from "../src/commands/fix.js";
import { isPathInFixScope } from "../src/commands/fix-scope.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { AislopConfig } from "../src/config/index.js";
import type { EngineContext } from "../src/engines/types.js";

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

	it("classifies new-line findings vs existing-file context without hiding either", () => {
		write(tmpDir, "tainted.ts", `${SECRET}export const extra = 1 as any;\n`);
		git(tmpDir, ["add", "."]);
		git(tmpDir, ["commit", "-m", "edit", "--no-verify"]);
		const scoped = runCli(["scan", tmpDir, "--changes", "--base", baseSha, "--json"]);
		const parsed = JSON.parse(scoped.stdout) as {
			diagnostics?: Array<{ rule: string; line: number; changeContext?: string }>;
		};
		const byRule = new Map((parsed.diagnostics ?? []).map((d) => [d.rule, d]));
		expect(byRule.get("security/hardcoded-secret")?.changeContext).toBe("existing-file-context");
		expect(byRule.get("ai-slop/unsafe-type-assertion")?.changeContext).toBe("changed-line");
	});

	it("does not classify full scans or staged scans", () => {
		write(tmpDir, "clean.ts", `${CLEAN}export const extra = 1 as any;\n`);
		git(tmpDir, ["add", "clean.ts"]);
		const full = runCli(["scan", tmpDir, "--json"]);
		const staged = runCli(["scan", tmpDir, "--staged", "--json"]);
		const fullDiag = (
			JSON.parse(full.stdout) as { diagnostics?: Array<{ changeContext?: string }> }
		).diagnostics?.[0];
		const stagedDiag = (
			JSON.parse(staged.stdout) as { diagnostics?: Array<{ changeContext?: string }> }
		).diagnostics?.[0];
		expect(fullDiag?.changeContext).toBeUndefined();
		expect(stagedDiag?.changeContext).toBeUndefined();
	});
});

const UNUSED_IMPORT = 'import { leftover } from "./missing";\nexport const value = 1;\n';
const FIXED_IMPORT = "export const value = 1;\n";

const slopConfig = (): AislopConfig => ({
	...DEFAULT_CONFIG,
	engines: {
		...DEFAULT_CONFIG.engines,
		format: false,
		lint: false,
		"code-quality": false,
		architecture: false,
		security: false,
		"ai-slop": true,
	},
	telemetry: { enabled: false },
});

const captureStdout = async (run: () => Promise<unknown>): Promise<string> => {
	const chunks: string[] = [];
	const original = process.stdout.write.bind(process.stdout);
	const previousCi = process.env.CI;
	process.env.CI = "1";
	process.stdout.write = ((chunk: unknown) => {
		chunks.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	try {
		await run();
		return chunks.join("");
	} finally {
		process.stdout.write = original;
		if (previousCi === undefined) delete process.env.CI;
		else process.env.CI = previousCi;
	}
};

const posixRel = (root: string, rel: string): string =>
	fs.readFileSync(path.join(root, ...rel.split("/")), "utf-8");

describe("fix --changes --base", () => {
	let tmpDir = "";
	let baseSha = "";

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-fix-scope-"));
		git(tmpDir, ["init"]);
		git(tmpDir, ["config", "user.email", "test@example.com"]);
		git(tmpDir, ["config", "user.name", "test"]);
		git(tmpDir, ["config", "commit.gpgsign", "false"]);
		write(tmpDir, "untouched.ts", UNUSED_IMPORT);
		git(tmpDir, ["add", "."]);
		git(tmpDir, ["commit", "-m", "base", "--no-verify"]);
		baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: tmpDir,
			encoding: "utf8",
		}).trim();
		git(tmpDir, ["checkout", "-b", "feature"]);
		write(tmpDir, "changed.ts", UNUSED_IMPORT);
		git(tmpDir, ["add", "."]);
		git(tmpDir, ["commit", "-m", "feat", "--no-verify"]);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("does not rewrite files outside the selected change set", async () => {
		await captureStdout(() =>
			fixCommand(tmpDir, slopConfig(), {
				verbose: false,
				changes: true,
				base: baseSha,
				showHeader: false,
			}),
		);
		expect(posixRel(tmpDir, "changed.ts")).toBe(FIXED_IMPORT);
		expect(posixRel(tmpDir, "untouched.ts")).toBe(UNUSED_IMPORT);
	});

	it("includes untracked files using the same semantics as scan --changes", async () => {
		write(tmpDir, "fresh.ts", UNUSED_IMPORT);
		write(tmpDir, "notes.txt", "leave me alone\n");
		await captureStdout(() =>
			fixCommand(tmpDir, slopConfig(), {
				verbose: false,
				changes: true,
				base: baseSha,
				showHeader: false,
			}),
		);
		expect(posixRel(tmpDir, "fresh.ts")).toBe(FIXED_IMPORT);
		expect(posixRel(tmpDir, "notes.txt")).toBe("leave me alone\n");
		expect(posixRel(tmpDir, "untouched.ts")).toBe(UNUSED_IMPORT);
	});

	it("fails when --changes and --staged are combined", async () => {
		const result = await fixCommand(tmpDir, slopConfig(), {
			verbose: false,
			changes: true,
			staged: true,
			showHeader: false,
		});
		expect(result.exitCode).toBe(1);
		expect(posixRel(tmpDir, "changed.ts")).toBe(UNUSED_IMPORT);
		expect(posixRel(tmpDir, "untouched.ts")).toBe(UNUSED_IMPORT);
	});

	it("fails when an explicit --base ref cannot be resolved", async () => {
		const result = await fixCommand(tmpDir, slopConfig(), {
			verbose: false,
			changes: true,
			base: "origin/does-not-exist",
			showHeader: false,
		});
		expect(result.exitCode).toBe(1);
		expect(posixRel(tmpDir, "changed.ts")).toBe(UNUSED_IMPORT);
	});
});

describe("fix --staged", () => {
	let tmpDir = "";

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-fix-staged-"));
		git(tmpDir, ["init"]);
		git(tmpDir, ["config", "user.email", "test@example.com"]);
		git(tmpDir, ["config", "user.name", "test"]);
		git(tmpDir, ["config", "commit.gpgsign", "false"]);
		write(tmpDir, "committed.ts", FIXED_IMPORT);
		git(tmpDir, ["add", "."]);
		git(tmpDir, ["commit", "-m", "init", "--no-verify"]);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("rewrites staged files only and leaves unstaged and untracked files alone", async () => {
		write(tmpDir, "staged.ts", UNUSED_IMPORT);
		git(tmpDir, ["add", "staged.ts"]);
		write(tmpDir, "unstaged.ts", UNUSED_IMPORT);
		write(tmpDir, "committed.ts", UNUSED_IMPORT);
		await captureStdout(() =>
			fixCommand(tmpDir, slopConfig(), {
				verbose: false,
				staged: true,
				showHeader: false,
			}),
		);
		expect(posixRel(tmpDir, "staged.ts")).toBe(FIXED_IMPORT);
		expect(posixRel(tmpDir, "unstaged.ts")).toBe(UNUSED_IMPORT);
		expect(posixRel(tmpDir, "committed.ts")).toBe(UNUSED_IMPORT);
	});
});

describe("fix scope path normalization", () => {
	it("treats OS-native and POSIX-relative paths as the same file", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-fix-scope-paths-"));
		try {
			const nativeFile = path.join(root, "src", "app.ts");
			const context = {
				rootDirectory: root,
				languages: ["typescript"],
				frameworks: ["none"],
				files: [nativeFile],
				installedTools: {},
				config: {
					quality: DEFAULT_CONFIG.quality,
					security: DEFAULT_CONFIG.security,
					lint: DEFAULT_CONFIG.lint,
				},
			} as EngineContext;
			expect(isPathInFixScope(context, nativeFile)).toBe(true);
			expect(isPathInFixScope(context, "src/app.ts")).toBe(true);
			expect(isPathInFixScope(context, path.join(root, "src", "other.ts"))).toBe(false);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
