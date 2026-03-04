import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectRiskyConstructs } from "../src/engines/security/risky.js";
import { scanSecrets } from "../src/engines/security/secrets.js";
import type { EngineContext } from "../src/engines/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

const makeContext = (files: string[]): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["typescript"],
	frameworks: ["none"],
	files,
	installedTools: {},
	config: {
		quality: {
			maxFunctionLoc: 80,
			maxFileLoc: 400,
			maxNesting: 4,
			maxParams: 6,
		},
		security: { audit: true, auditTimeout: 25000 },
	},
});

const writeFile = (filename: string, content: string): string => {
	const filePath = path.join(tmpDir, filename);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
};

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "slop-security-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── scanSecrets ──────────────────────────────────────────────────────────────

describe("scanSecrets", () => {
	it("returns no diagnostics for a clean file", async () => {
		const filePath = writeFile(
			"clean.ts",
			"export function add(a: number, b: number) { return a + b; }",
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics).toHaveLength(0);
	});

	it("detects a hardcoded API key", async () => {
		const filePath = writeFile(
			"config.ts",
			'const apiKey = "abcdefghijklmnopqrstu12345";',
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].rule).toBe("security/hardcoded-secret");
		expect(diagnostics[0].severity).toBe("error");
		expect(diagnostics[0].engine).toBe("security");
	});

	it("detects an AWS Access Key ID", async () => {
		const filePath = writeFile(
			"aws.ts",
			"const accessKeyId = 'AKIAIOSFODNN7EXAMPLE';",
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].message).toContain("AWS Access Key");
	});

	it("detects a hardcoded password", async () => {
		const filePath = writeFile(
			"db.ts",
			'const password = "super-secret-password-123";',
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].message).toContain("password");
	});

	it("detects a private key header", async () => {
		const filePath = writeFile(
			"keys.ts",
			"const key = `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...`;",
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].message).toContain("Private key");
	});

	it("detects a JWT token", async () => {
		const filePath = writeFile(
			"auth.ts",
			// A realistic-looking (fake) JWT
			'const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";',
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].message).toContain("JWT");
	});

	it("detects a database connection string with credentials", async () => {
		const filePath = writeFile(
			"db-url.ts",
			'const dbUrl = "postgres://user:password123@localhost:5432/mydb";',
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].message).toContain("Database connection string");
	});

	it("detects a GitHub token", async () => {
		const filePath = writeFile(
			"github.ts",
			"const ghToken = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk';",
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		// The token may be matched by either the GitHub-specific or generic token pattern
		const messages = diagnostics.map((d) => d.message);
		const matched = messages.some(
			(m) => m.includes("GitHub token") || m.includes("Authentication token"),
		);
		expect(matched).toBe(true);
	});

	it("detects a Slack token", async () => {
		const filePath = writeFile(
			"slack.ts",
			"const slackToken = 'xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx';",
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		// The token may be matched by either the Slack-specific or generic token pattern
		const messages = diagnostics.map((d) => d.message);
		const matched = messages.some(
			(m) => m.includes("Slack token") || m.includes("Authentication token"),
		);
		expect(matched).toBe(true);
	});

	it("reports relative file paths", async () => {
		const filePath = writeFile(
			"subdir/config.ts",
			'const apiKey = "abcdefghijklmnopqrstu12345";',
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(path.isAbsolute(diagnostics[0].filePath)).toBe(false);
	});

	it("reports correct line numbers for secrets", async () => {
		const filePath = writeFile(
			"lines.ts",
			"const a = 1;\nconst b = 2;\nconst password = 'hunter2hunter2';\nconst c = 3;",
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].line).toBe(3);
	});

	it("marks diagnostics as not fixable", async () => {
		const filePath = writeFile(
			"fix.ts",
			'const apiKey = "abcdefghijklmnopqrstu12345";',
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].fixable).toBe(false);
	});

	it("category is Security", async () => {
		const filePath = writeFile(
			"cat.ts",
			'const apiKey = "abcdefghijklmnopqrstu12345";',
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].category).toBe("Security");
	});

	it("returns empty array when files list is empty", async () => {
		const diagnostics = await scanSecrets(makeContext([]));
		expect(diagnostics).toHaveLength(0);
	});

	it("detects generic authentication token", async () => {
		const filePath = writeFile(
			"token.ts",
			'const token = "abcdefghijklmnopqrstu12345ABCD";',
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].message).toContain("token");
	});

	it("handles multiple secrets in the same file", async () => {
		const filePath = writeFile(
			"multi.ts",
			[
				'const apiKey = "abcdefghijklmnopqrstu12345";',
				"const awsKey = 'AKIAIOSFODNN7EXAMPLE';",
			].join("\n"),
		);
		const diagnostics = await scanSecrets(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(2);
	});
});

// ─── detectRiskyConstructs ────────────────────────────────────────────────────

describe("detectRiskyConstructs", () => {
	it("returns no diagnostics for a clean file", async () => {
		const filePath = writeFile(
			"clean.ts",
			"export function safeOp(data: unknown) { return JSON.parse(JSON.stringify(data)); }",
		);
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		expect(diagnostics).toHaveLength(0);
	});

	it("detects eval() in TypeScript", async () => {
		const filePath = writeFile("eval.ts", "const result = eval('1 + 1');");
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].rule).toBe("security/eval");
		expect(diagnostics[0].severity).toBe("error");
		expect(diagnostics[0].engine).toBe("security");
	});

	it("detects eval() in JavaScript", async () => {
		const filePath = writeFile("eval.js", "eval('console.log(1)');");
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].rule).toBe("security/eval");
	});

	it("does not flag 'evaluate' as eval", async () => {
		const filePath = writeFile(
			"evaluate.ts",
			"function evaluate(expr: string) { return parseFloat(expr); }",
		);
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		const evalDiags = diagnostics.filter((d) => d.rule === "security/eval");
		expect(evalDiags).toHaveLength(0);
	});

	it("detects new Function() in TypeScript", async () => {
		const filePath = writeFile(
			"fn.ts",
			"const fn = new Function('x', 'return x * 2');",
		);
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].rule).toBe("security/new-function");
	});

	it("detects innerHTML assignment in TypeScript", async () => {
		const filePath = writeFile("dom.ts", "element.innerHTML = userInput;");
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].rule).toBe("security/innerhtml");
	});

	it("detects dangerouslySetInnerHTML in TSX", async () => {
		const filePath = writeFile(
			"comp.tsx",
			"return <div dangerouslySetInnerHTML={{ __html: content }} />;",
		);
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].rule).toBe("security/dangerously-set-innerhtml");
	});

	it("does NOT detect dangerouslySetInnerHTML in .ts files (only tsx/jsx)", async () => {
		const filePath = writeFile(
			"comp.ts",
			"const html = dangerouslySetInnerHTML;",
		);
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		const dsiDiags = diagnostics.filter(
			(d) => d.rule === "security/dangerously-set-innerhtml",
		);
		expect(dsiDiags).toHaveLength(0);
	});

	it("detects pickle.load in Python", async () => {
		const filePath = writeFile(
			"serialize.py",
			"import pickle\ndata = pickle.loads(raw_bytes)",
		);
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].rule).toBe("security/pickle-load");
	});

	it("detects exec() in Python", async () => {
		const filePath = writeFile(
			"exec_test.py",
			"exec('import os; os.system(\"ls\")')",
		);
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].rule).toBe("security/python-exec");
	});

	it("detects SQL injection via template literal", async () => {
		const filePath = writeFile(
			"sql.ts",
			"const rows = await db.query(`SELECT * FROM users WHERE id = ${userId}`);",
		);
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].rule).toBe("security/sql-injection");
	});

	it("reports correct line numbers", async () => {
		const filePath = writeFile(
			"lines.ts",
			"const a = 1;\nconst b = 2;\neval('bad code');\nconst c = 3;",
		);
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].line).toBe(3);
	});

	it("does not flag Python patterns in .ts files", async () => {
		const filePath = writeFile("not-python.ts", "// pickle.loads(data)\n");
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		const pickleDiags = diagnostics.filter(
			(d) => d.rule === "security/pickle-load",
		);
		expect(pickleDiags).toHaveLength(0);
	});

	it("marks diagnostics as not fixable", async () => {
		const filePath = writeFile("fix.ts", "eval('risky');");
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].fixable).toBe(false);
	});

	it("category is Security", async () => {
		const filePath = writeFile("cat.ts", "eval('risky');");
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].category).toBe("Security");
	});

	it("returns empty array when files list is empty", async () => {
		const diagnostics = await detectRiskyConstructs(makeContext([]));
		expect(diagnostics).toHaveLength(0);
	});

	it("detects multiple risky constructs in the same file", async () => {
		const filePath = writeFile(
			"multi.ts",
			"eval('bad');\nelement.innerHTML = userInput;\n",
		);
		const diagnostics = await detectRiskyConstructs(makeContext([filePath]));
		expect(diagnostics.length).toBeGreaterThanOrEqual(2);
	});
});
